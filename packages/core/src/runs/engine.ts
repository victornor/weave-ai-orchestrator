import { credentialReaderFor, reconcileRuntimeCredential } from '../workspace/loader.js';
import { gateRuntimeForLogin, ungateRuntime } from './authgate.js';
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { nowIso } from '@agent-conductor/db';
import {
  AC_ENV, RUN_REPORT_JSON_SCHEMA, RunReportSchema, extractReport, estimateCostCents,
  type Agent, type Role, type Project, type Run, type RunEvent, type RunErrorFamily, type RunLiveness,
  type RunPhase, type RunReport, type Ticket, type Wakeup, type SessionPolicy, type PermissionMode,
} from '@agent-conductor/shared';
import type { McpServerConfig, RuntimeEvent, TurnHandle, TurnInput, TurnResult } from '@agent-conductor/runtime-sdk';
import type { WorkspaceContext } from '../context.js';
import type { CoreServices } from '../api.js';
import { createSessions, type SessionsService } from '../sessions/index.js';
import { buildTurnPrompt, type TurnPromptOptions } from '../prompts/index.js';
import { ensureHomeCurrent } from '../workers/home.js';
import { recordUsage, ACCOUNT_PROBE_TIMEOUT_MS } from '../usage/index.js';
import { ensureFreshCredential } from './credentialFreshness.js';
import { git } from '../util/git.js';
import { emitRunEvent, runState } from './active.js';
import { modelSettingFor } from '../models/resolve.js';
import { runTokenSecret, signRunToken } from './runtoken.js';

/**
 * An interactive session's agent's first turn (VS-101): read the ticket and its context, post one
 * comment, nothing else. Enforced by the runtime's own `--allowedTools`, not by prompt wording —
 * `ac_ticket_comment` is included because the requirement is not silence, it is stating what the
 * agent understands and is ready to do.
 */
export const FIRST_TURN_ALLOWLIST = ['ac_inbox', 'ac_ticket_get', 'ac_ticket_comments', 'ac_ticket_comment', 'ac_ticket_document_get', 'ac_worktree_status', 'Read', 'Grep', 'Glob'];

const PAYLOAD_LIMIT = 8 * 1024;
const RETRY_BACKOFF_MS = [30_000, 120_000, 600_000];
/**
 * The families the system retries by itself. `provider_quota` is deliberately absent (VS-56, ADR
 * 0010): a usage limit is not transient the way an upstream 503 is — the runtime has already said
 * the window is exhausted — so the ladder could only fail three more times at rising cost before
 * reaching the same card. A quota failure parks the worker on its first occurrence instead.
 */
const RETRYABLE: RunErrorFamily[] = ['transient_upstream'];

// ---------- redaction ----------

export function makeRedactor(secrets: string[]): (v: unknown) => unknown {
  const values = secrets.filter((s) => typeof s === 'string' && s.length >= 8);
  const scrubString = (s: string): string => {
    let out = s;
    for (const v of values) if (v && out.includes(v)) out = out.split(v).join('[redacted]');
    out = out.replace(/(authorization"?\s*[:=]\s*"?)(bearer\s+)?[A-Za-z0-9._~+/=-]{8,}/gi, '$1[redacted]');
    return out;
  };
  const walk = (v: unknown, depth = 0): unknown => {
    if (typeof v === 'string') return scrubString(v);
    if (depth > 8) return v;
    if (Array.isArray(v)) return v.map((x) => walk(x, depth + 1));
    if (v && typeof v === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, val] of Object.entries(v as Record<string, unknown>)) out[k] = walk(val, depth + 1);
      return out;
    }
    return v;
  };
  return (v: unknown) => walk(v);
}

function boundPayload(payload: unknown): Record<string, unknown> {
  const obj = (payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : { value: payload }) as Record<string, unknown>;
  const text = JSON.stringify(obj);
  if (text.length <= PAYLOAD_LIMIT) return obj;
  return { truncated: true, bytes: text.length, preview: text.slice(0, PAYLOAD_LIMIT - 200) };
}

// ---------- run token ----------

/** Mint the run's MCP bearer token (PLAN §9.1); the claim shape lives in runtoken.ts. */
export async function mintRunToken(ctx: WorkspaceContext, claims: { agentId: string; runId: string; ticketId: string | null; kind: string; projectId: string | null; roleId: string | null }): Promise<string> {
  return signRunToken(runTokenSecret(ctx.db), {
    workspaceId: ctx.workspaceId, runId: claims.runId, agentId: claims.agentId,
    agentKind: claims.kind === 'conductor' ? 'conductor' : 'worker',
    projectId: claims.projectId, ticketId: claims.ticketId, roleId: claims.roleId,
  });
}

// ---------- helpers ----------

/**
 * A role's secrets as environment variables, and the values to redact from everything the turn says.
 *
 * The daemon's own environment wins (VS-92 keeps that precedence): an operator who exports the
 * variable on the host still decides. The workspace store only fills a name the host does not carry,
 * which is what a secret the human typed on a decision card is. A name with no value anywhere is
 * omitted rather than passed as empty — an empty credential fails later and more confusingly.
 */
function roleSecretsEnv(ctx: WorkspaceContext, deps: () => CoreServices, role: Role | null): { env: Record<string, string>; values: string[] } {
  const env: Record<string, string> = {};
  const values: string[] = [];
  for (const name of role?.secrets ?? []) {
    const secret = ctx.db.get<{ envVarName: string }>('SELECT env_var_name FROM secrets WHERE workspace_id = ? AND name = ?', [ctx.workspaceId, name]);
    const varName = secret?.envVarName ?? name;
    const value = process.env[varName] ?? deps().secrets.value(name) ?? null;
    if (value) { env[varName] = value; values.push(value); }
  }
  return { env, values };
}

function classifyLiveness(status: Run['status'], report: RunReport | null, ticketStatus: string | null): RunLiveness {
  if (status !== 'succeeded') return 'failed';
  if (!report) return 'empty';
  switch (report.state) {
    case 'needs_decision': return 'needs_decision';
    case 'blocked': return 'blocked';
    case 'failed': return 'failed';
    case 'idle': return 'empty';
    case 'working': return ticketStatus === 'proposing' || ticketStatus === 'proposed' ? 'plan_only' : 'advanced';
    default: return 'advanced';
  }
}

function sessionPolicyFor(agent: Agent, role: Role | null): SessionPolicy {
  if (agent.kind === 'conductor') return 'persistent';
  return (role?.sessionPolicy ?? 'per_ticket') as SessionPolicy;
}

export interface EngineOptions { sessions?: SessionsService; promptOptions?: TurnPromptOptions }

/**
 * PLAN §7.3: prepare home → prepare worktree → build prompt → mint token → spawn → collect → finalize.
 * Never throws for a failed turn: the failure is recorded on the run row.
 */
export async function executeRun(ctx: WorkspaceContext, deps: () => CoreServices, runId: string, opts: EngineOptions = {}): Promise<Run> {
  const log = ctx.log('run').child({ runId });
  const state = runState(ctx);
  const sessions = opts.sessions ?? createSessions(ctx);

  const run = ctx.db.get<Run>('SELECT * FROM runs WHERE id = ?', [runId]);
  if (!run) throw new Error(`run ${runId} not found`);
  const agent = ctx.db.get<Agent>('SELECT * FROM agents WHERE id = ?', [run.agentId])!;
  const role = agent.roleId ? ctx.db.get<Role>('SELECT * FROM roles WHERE id = ?', [agent.roleId]) ?? null : null;
  const project = agent.projectId ? ctx.db.get<Project>('SELECT * FROM projects WHERE id = ?', [agent.projectId]) ?? null : null;
  const ticket = agent.ticketId ? ctx.db.get<Ticket>('SELECT * FROM tickets WHERE id = ?', [agent.ticketId]) ?? null : null;
  const wakes = (run.wakeupIds ?? []).length
    ? ctx.db.all<Wakeup>(`SELECT * FROM wakeups WHERE id IN (${(run.wakeupIds as string[]).map(() => '?').join(',')})`, run.wakeupIds as string[])
    : [];

  const runDir = join(ctx.paths.runs, runId);
  mkdirSync(runDir, { recursive: true });
  const eventsPath = join(runDir, 'events.jsonl');

  if (!state.active.has(runId)) state.active.set(runId, { runId, agentId: agent.id, startedAt: Date.now(), pid: null, cancel: async () => { /* replaced once the runtime hands us a handle */ } });

  const started = Date.now();
  let seq = 0;
  let redact = makeRedactor([]);
  const record = (type: RunEvent['type'], payload: Record<string, unknown>, stream: 'stdout' | 'stderr' | 'runtime' | 'system' = 'runtime', level = 'info'): void => {
    seq += 1;
    const ts = nowIso();
    const clean = redact(payload) as Record<string, unknown>;
    try {
      ctx.db.run('INSERT INTO run_events (run_id, seq, ts, type, stream, level, payload_json) VALUES (?,?,?,?,?,?,?)', [runId, seq, ts, type, stream, level, JSON.stringify(boundPayload(clean))]);
      ctx.db.run('UPDATE runs SET last_event_at = ? WHERE id = ?', [ts, runId]);
    } catch (e) { log.warn({ err: String(e) }, 'failed to persist run event'); }
    try { appendFileSync(eventsPath, JSON.stringify({ seq, ts, type, stream, payload: clean }) + '\n', 'utf8'); } catch { /* disk full etc; the DB row is authoritative */ }
    emitRunEvent(ctx, runId, { id: String(seq), runId, seq, ts, type, stream, level, payload: clean });
  };

  const phase = async <T>(name: RunPhase, fn: () => Promise<T>): Promise<T> => {
    const t0 = Date.now();
    try { return await fn(); } finally { record('run.phase.timing', { phase: name, ms: Date.now() - t0 }, 'system'); }
  };

  // The one place a turn's runtime, model and effort come from (VS-77). The agent row records the
  // runtime it is on so the worker pages and the account probe can read it; it is corrected here
  // rather than consulted, so a stale row can never decide what this turn launches.
  const setting = modelSettingFor(ctx.config, agent.kind);

  ctx.db.update('runs', runId, { status: 'running', startedAt: nowIso(), runtimeId: setting.runtime, model: setting.model ?? null });
  ctx.db.update('agents', agent.id, { status: 'running', runtimeId: setting.runtime, updatedAt: nowIso() });
  // The row was loaded before that update; finalize reads it for what this turn ran on, so it has to
  // carry the resolved values rather than what the dispatcher queued the run with.
  Object.assign(run, { runtimeId: setting.runtime, model: setting.model ?? null });
  Object.assign(agent, { runtimeId: setting.runtime });
  if (ticket) ctx.db.run('UPDATE tickets SET execution_run_id = ?, execution_locked_at = ? WHERE id = ?', [runId, nowIso(), ticket.id]);
  ctx.events.emit('run.started', 'run', runId, { agentId: agent.id, ticketId: agent.ticketId, turnEpoch: run.turnEpoch });
  record('run.started', { agentId: agent.id, turnEpoch: run.turnEpoch, wakeups: run.wakeupIds ?? [] }, 'system');

  let result: TurnResult | null = null;
  let failure: { code: string; family: RunErrorFamily; message: string } | null = null;
  let promptOptions: TurnPromptOptions = { ...(opts.promptOptions ?? {}) };

  try {
    // 1. prepare home
    await phase('prepare_home', async () => {
      const r = await ensureHomeCurrent(ctx, deps, agent);
      if (r.briefUpdated) promptOptions.briefUpdated = true;
      if (r.charterChanged) promptOptions.charterChanged = 'the role charter was revised since your last turn';
    });

    // 2. prepare worktree (never reset, clean or switch branches)
    if (agent.worktreePath) {
      await phase('prepare_worktree', async () => {
        const fetched = await git(['fetch', 'origin'], agent.worktreePath!, 120_000);
        if (!fetched.ok) record('error', { phase: 'prepare_worktree', message: fetched.stderr.trim().slice(0, 300) }, 'system', 'warn');
      });
    }

    // 3. build the turn prompt
    const policy = sessionPolicyFor(agent, role);
    const turnSession = sessions.forTurn({ id: agent.id, kind: agent.kind, runtimeId: setting.runtime }, policy);
    promptOptions = { ...promptOptions, isFirstTurn: promptOptions.isFirstTurn ?? turnSession.isFirstTurn, sessionStale: turnSession.stale, turnEpoch: run.turnEpoch, runId };
    const prompt = await phase('build_prompt', async () => {
      const text = await buildTurnPrompt(ctx, deps, agent, wakes, promptOptions);
      writeFileSync(join(runDir, 'prompt.md'), text, 'utf8');
      return text;
    });

    // 4. run token + MCP config + env
    const token = await mintRunToken(ctx, { agentId: agent.id, runId, ticketId: agent.ticketId, kind: agent.kind, projectId: agent.projectId, roleId: agent.roleId });
    const mcpServers: Record<string, McpServerConfig> = {
      agentconductor: { type: 'http', url: `${ctx.loopbackUrl.replace(/\/$/, '')}/mcp/runs/${runId}`, headers: { Authorization: `Bearer ${token}` } },
    };
    writeFileSync(join(runDir, 'mcp.json'), JSON.stringify({ mcpServers }, null, 2), 'utf8');

    const secrets = roleSecretsEnv(ctx, deps, role);
    redact = makeRedactor([token, ...secrets.values]);
    const env: Record<string, string> = {
      [AC_ENV.API_URL]: ctx.loopbackUrl,
      [AC_ENV.RUN_TOKEN]: token,
      [AC_ENV.RUN_ID]: runId,
      [AC_ENV.AGENT_ID]: agent.id,
      [AC_ENV.AGENT_KIND]: agent.kind,
      [AC_ENV.WORKSPACE_ID]: ctx.workspaceId,
      [AC_ENV.WAKE_REASON]: wakes.map((w) => `${w.source}:${w.reason}`).join('; ').slice(0, 400),
      ...(agent.roleId ? { [AC_ENV.ROLE_ID]: agent.roleId } : {}),
      ...(agent.projectId ? { [AC_ENV.PROJECT_ID]: agent.projectId } : {}),
      ...(agent.ticketId ? { [AC_ENV.TICKET_ID]: agent.ticketId } : {}),
      ...(agent.worktreePath ? { [AC_ENV.WORKTREE]: agent.worktreePath } : {}),
      ...secrets.env,
    };

    const runtime = ctx.registries.runtimes.get(setting.runtime);
    if (!runtime) throw Object.assign(new Error(`runtime ${setting.runtime} is not registered`), { ocFamily: 'tooling' as RunErrorFamily, ocCode: 'runtime_unreachable' });

    const permission = (role?.permission ?? {}) as { mode?: PermissionMode; allowed?: string[]; denied?: string[] };
    // An interactive session's very first turn (VS-101) is held to reading its ticket and posting
    // one comment — a ceiling under the role's own permission, never a widening of it: a role that
    // already denies one of these tools still denies it.
    const isFirstInteractiveTurn = Boolean(ticket?.interactiveSession) && agent.turnCount === 0;
    const deniedSet = new Set(permission.denied ?? []);
    const allowedTools = isFirstInteractiveTurn
      ? (permission.allowed?.length ? permission.allowed.filter((t) => FIRST_TURN_ALLOWLIST.includes(t)) : FIRST_TURN_ALLOWLIST)
          .filter((t) => !deniedSet.has(t))
      : permission.allowed;
    const instructionsPath = join(agent.homePath, 'AGENTS.md');
    let systemPromptText = '';
    try { systemPromptText = readFileSync(instructionsPath, 'utf8'); } catch { systemPromptText = ''; }

    const configHome = join(ctx.paths.runtimesHome, setting.runtime);
    const reconcileCredential = (): void => reconcileRuntimeCredential(setting.runtime, configHome, {
      readCredential: credentialReaderFor(ctx.registries, setting.runtime),
      isolated: ctx.isolated, daemonConfigDir: ctx.daemonConfigDir,
    });
    reconcileCredential();
    const turnTimeoutMs = (ctx.config.defaults.turnTimeoutSec ?? 2700) * 1000;

    const input: TurnInput = {
      runId,
      turnEpoch: run.turnEpoch,
      cwd: agent.homePath,
      worktree: agent.worktreePath ? { path: agent.worktreePath, branch: agent.branch ?? '' } : null,
      session: { policy: turnSession.policy, ref: turnSession.ref, isFirstTurn: turnSession.isFirstTurn },
      systemPrompt: { text: systemPromptText, mode: turnSession.isFirstTurn ? 'inject' : 'skip' },
      prompt,
      outputSchema: RUN_REPORT_JSON_SCHEMA as unknown as Record<string, unknown>,
      mcpServers,
      env,
      options: { liveInput: ctx.config.defaults.liveInput },
      limits: { timeoutMs: turnTimeoutMs },
      permission: { mode: permission.mode ?? ctx.config.defaults.permissionMode ?? 'auto', allowedTools, deniedTools: permission.denied },
      model: setting.model ?? null,
      effort: setting.effort ?? null,
      configHome,
    };

    // 5. spawn + stream
    result = await phase('turn', async () => {
      // VS-105: a burst of simultaneous spawns must not become a burst of independent credential
      // refreshes. This is a no-op for a runtime whose adapter cannot report credential facts.
      const fresh = await ensureFreshCredential({
        runtimeId: setting.runtime, configHome, adapter: runtime,
        minValidMs: turnTimeoutMs, probeTimeoutMs: ACCOUNT_PROBE_TIMEOUT_MS, reconcile: reconcileCredential,
      });
      if (!fresh.ok) throw Object.assign(new Error(fresh.message), { ocFamily: 'auth' as RunErrorFamily, ocCode: 'credential_refresh_failed' });
      return runtime.runTurn(
        input,
        {
          onSpawn: (info) => {
            ctx.db.update('runs', runId, { pid: info.pid, pgid: info.pgid ?? null });
            const entry = state.active.get(runId);
            if (entry) entry.pid = info.pid;
            record('turn.started', { pid: info.pid }, 'system');
          },
          onEvent: (ev: RuntimeEvent) => record(ev.type, ev.payload ?? {}),
          onRaw: () => { /* raw stream is the runtime adapter's own concern; normalized events are recorded above */ },
        },
        (handle: TurnHandle) => {
          const existing = state.active.get(runId);
          if (existing) {
            existing.cancel = (mode) => handle.cancel(mode);
            existing.send = handle.send ? (text) => handle.send!(text) : undefined;
          }
        },
      );
    });
  } catch (e) {
    const err = e as Error & { ocFamily?: RunErrorFamily; ocCode?: string };
    failure = { code: err.ocCode ?? 'engine_error', family: err.ocFamily ?? 'tooling', message: err.message.slice(0, 500) };
    log.error({ err: err.message }, 'run failed in the engine');
    record('error', { message: failure.message, code: failure.code }, 'system', 'error');
  }

  // 6. collect result
  const report = await phase('collect_result', async () => {
    if (!result) return null;
    if (result.structured) {
      const parsed = RunReportSchema.safeParse(result.structured);
      if (parsed.success) return parsed.data;
    }
    return extractReport(result.finalText);
  });

  // 7. finalize
  return finalize(ctx, deps, sessions, {
    run, agent, role, project, ticket, wakes, result, failure, report,
    durationMs: Date.now() - started,
    sessionId: sessions.active(agent.id)?.id ?? null,
    cancelled: state.active.get(runId)?.cancelled ?? null,
    record,
  });
}

interface FinalizeInput {
  run: Run; agent: Agent; role: Role | null; project: Project | null; ticket: Ticket | null; wakes: Wakeup[];
  result: TurnResult | null; failure: { code: string; family: RunErrorFamily; message: string } | null; report: RunReport | null;
  durationMs: number; sessionId: string | null; cancelled: 'interrupt' | 'kill' | null;
  record: (type: RunEvent['type'], payload: Record<string, unknown>, stream?: 'stdout' | 'stderr' | 'runtime' | 'system', level?: string) => void;
}

function finalize(ctx: WorkspaceContext, deps: () => CoreServices, sessions: SessionsService, f: FinalizeInput): Run {
  const log = ctx.log('run').child({ runId: f.run.id });
  const now = nowIso();
  const runId = f.run.id;
  const r = f.result;

  let status: Run['status'] = 'succeeded';
  let errorCode: string | null = null;
  let errorFamily: RunErrorFamily | null = null;
  if (f.failure) { status = 'failed'; errorCode = f.failure.code; errorFamily = f.failure.family; }
  else if (r?.timedOut) { status = 'timed_out'; errorCode = 'timeout'; errorFamily = 'tooling'; }
  else if (r?.error) { status = 'failed'; errorCode = r.error.code; errorFamily = r.error.family; }
  else if (r && r.exitCode !== 0 && r.exitCode !== null) { status = 'failed'; errorCode = `exit_${r.exitCode}`; errorFamily = 'unknown'; }
  if (f.cancelled === 'interrupt' || (!f.failure && !r?.error && (r?.signal === 'SIGTERM' || r?.signal === 'SIGKILL' || r?.exitCode === 143 || r?.exitCode === 137))) {
    // Daemon shutdown, an upgrade's drain timeout, or a human interrupt: not the agent's failure.
    // Boot recovery re-queues the wake and the session resumes where it stopped.
    status = 'interrupted'; errorCode = 'interrupted'; errorFamily = 'tooling';
  } else if (f.cancelled) { status = 'cancelled'; errorCode = errorCode ?? 'cancelled'; errorFamily = errorFamily ?? 'tooling'; }

  const usage = r?.usage ?? null;
  const model = r?.model ?? f.run.model ?? null;
  let costCents: number | null = null;
  let costStatus: 'reported' | 'estimated' | 'unpriced' = 'unpriced';
  if (r?.cost && typeof r.cost.usd === 'number') { costCents = Math.round(r.cost.usd * 100); costStatus = r.cost.status === 'reported' ? 'reported' : 'estimated'; }
  else if (usage) {
    const est = estimateCostCents(model, { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, cachedInputTokens: usage.cachedInputTokens }, ctx.config.pricingOverrides);
    if (est !== null) { costCents = est; costStatus = 'estimated'; }
  }
  const liveness = classifyLiveness(status, f.report, f.ticket?.status ?? null);
  const summary = f.report?.summary ?? (r?.finalText ? r.finalText.slice(0, 1000) : f.failure?.message ?? null);

  // VS-137: an authentication failure that keeps recurring on one worker, with the runtime confirmed
  // healthy enough to release every other agent in between, is a fact about the worker rather than
  // the runtime. Three in a row — this run plus its two immediate predecessors, none of which
  // succeeded — stops the automatic resume below and falls through to the human instead, the same way
  // the retry ladder stops when its own attempts are spent.
  let authFailuresExhausted = false;
  if (errorFamily === 'auth') {
    const prior = ctx.db.all<{ status: string; errorFamily: string | null }>(
      'SELECT status, error_family FROM runs WHERE agent_id = ? AND id != ? ORDER BY created_at DESC, rowid DESC LIMIT 2',
      [f.agent.id, runId],
    );
    authFailuresExhausted = prior.length === 2 && prior.every((r2) => r2.status === 'failed' && r2.errorFamily === 'auth');
  }

  ctx.db.transaction(() => {
    ctx.db.update('runs', runId, {
      status, finishedAt: now, exitCode: r?.exitCode ?? null, signal: r?.signal ?? null,
      errorCode, errorFamily, usageJson: usage, costCents, resultJson: f.report ?? null, liveness,
      summary, sessionId: f.sessionId, model,
      promptPath: join(ctx.paths.runs, runId, 'prompt.md'), logPath: join(ctx.paths.runs, runId, 'events.jsonl'),
    });

    if (f.sessionId) {
      sessions.record(f.sessionId, {
        ref: r?.session ?? undefined,
        runId,
        error: status === 'succeeded' ? null : errorCode,
        usage: usage ? { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, cachedInputTokens: usage.cachedInputTokens } : null,
      });
    }

    const agentStatus = status === 'succeeded' ? 'active' : (errorFamily && RETRYABLE.includes(errorFamily)) || status === 'cancelled' ? 'active' : 'error';
    ctx.db.update('agents', f.agent.id, {
      status: agentStatus,
      turnEpoch: f.run.turnEpoch,
      turnCount: f.agent.turnCount + 1,
      lastRunAt: now,
      errorText: status === 'succeeded' ? null : (f.failure?.message ?? r?.error?.message ?? errorCode),
      // The agent took a turn, so whatever paused it is spent: the pause reason and its structured
      // twin are cleared together, always. `parkForHuman` below may set them again for this failure.
      ...(agentStatus === 'active' ? { pauseReason: null, pauseDetailJson: null } : {}),
      updatedAt: now,
    });

    // VS-137: the wake that discovered a runtime authentication outage is not this turn's fault — it
    // is preserved, exactly as every other agent's still-queued wake on the gated runtime already is,
    // so the same recovery path resumes this agent too once the runtime is confirmed healthy again.
    // A wake preserved this way is put back to `queued` rather than left `claimed`, so the dispatcher
    // (which only claims `queued` wakes) can pick it up the moment this agent is active again.
    const preserveWake = errorFamily === 'auth' && !authFailuresExhausted;
    for (const w of f.wakes) {
      if (preserveWake) {
        ctx.db.update('wakeups', w.id, { status: 'queued', runId: null, claimedAt: null });
      } else {
        ctx.db.update('wakeups', w.id, { status: status === 'succeeded' ? 'completed' : 'failed', runId, finishedAt: now });
      }
    }

    if (f.ticket) ctx.db.run('UPDATE tickets SET execution_run_id = NULL, execution_locked_at = NULL WHERE id = ? AND execution_run_id = ?', [f.ticket.id, runId]);

    if (usage) {
      recordUsage(ctx, {
        agentId: f.agent.id, runId, runtimeId: f.run.runtimeId, projectId: f.agent.projectId, roleId: f.agent.roleId,
        ticketId: f.agent.ticketId, provider: r?.provider ?? null, model,
        inputTokens: usage.inputTokens, cachedInputTokens: usage.cachedInputTokens ?? 0, outputTokens: usage.outputTokens,
        // Only a runtime-reported cost is passed through; otherwise recordUsage estimates from the pricing table.
        costCents: costStatus === 'reported' ? costCents : null,
        durationMs: f.durationMs, occurredAt: now,
      });
    }
  });

  const finalRun = ctx.db.get<Run>('SELECT * FROM runs WHERE id = ?', [runId])!;
  f.record('run.finalized', { status, liveness, costCents, model }, 'system');
  ctx.events.emit('run.finished', 'run', runId, { agentId: f.agent.id, ticketId: f.agent.ticketId, status, liveness, costCents, summary });
  runState(ctx).active.delete(runId);

  // An authentication failure is not this turn's problem but the runtime's: one credential is shared
  // per host, so retrying can only fail again and parking would raise a card per worker for one
  // outage. It leaves the ladder entirely and gates the runtime once instead (VS-75). Nothing here
  // rewrites the credential — there is no second copy to restore, and the owner may have renewed it
  // since this turn failed.
  //
  // VS-137: unless this is the third such failure in a row on this same worker with the runtime
  // confirmed healthy in between — at that point it is this worker's own problem, not the runtime's,
  // and it is put to the human exactly as the retry ladder does when its own attempts are spent.
  if (errorFamily === 'auth' && authFailuresExhausted) {
    parkForHuman(ctx, deps, f, errorFamily, errorCode, f.failure?.message ?? r?.error?.message ?? null);
  } else if (errorFamily === 'auth') {
    gateRuntimeForLogin(ctx, deps, { runtimeId: f.run.runtimeId, agentId: f.agent.id, agentName: f.agent.name, runId, ticketId: f.agent.ticketId }, f.failure?.message ?? r?.error?.message ?? null);
  } else if (errorFamily && RETRYABLE.includes(errorFamily)) {
    // Retry the transient family with backoff (30 s / 2 min / 10 min, max 3).
    // A usage limit is not in RETRYABLE and falls through to parking below.
    const attempt = countRetries(ctx, runId);
    const maxAttempts = RETRY_BACKOFF_MS.length;
    if (attempt < maxAttempts) {
      const delay = RETRY_BACKOFF_MS[attempt]!;
      const notBefore = new Date(Date.now() + delay).toISOString();
      ctx.db.update('runs', runId, { scheduledRetryAt: notBefore });
      try {
        deps().wake.enqueue(f.agent.id, {
          source: 'retry', reason: `retry after ${errorCode ?? errorFamily}`,
          payload: { retryOfRunId: runId, attempt: attempt + 1 }, notBefore,
          idempotencyKey: `retry:${runId}:${attempt + 1}`, requestedBy: { kind: 'system', id: null },
        });
      } catch (e) { log.warn({ err: String(e) }, 'failed to schedule retry wake'); }
    } else {
      log.warn({ runId, errorFamily }, 'retry budget exhausted');
      parkForHuman(ctx, deps, f, errorFamily, errorCode, f.failure?.message ?? r?.error?.message ?? null);
    }
  } else if (status === 'failed' && f.agent.kind === 'worker' && errorFamily !== 'model_refusal') {
    parkForHuman(ctx, deps, f, errorFamily, errorCode, f.failure?.message ?? r?.error?.message ?? null);
  }
  // A turn that ran proves this runtime's credential works, so a gate left over from an earlier
  // outage is stale: clear it here rather than waiting for the supervisor's next probe.
  if (status === 'succeeded') {
    try { if (deps().accounts.gatedRuntimes().includes(f.agent.runtimeId)) ungateRuntime(ctx, deps, f.agent.runtimeId); } catch { /* the supervisor will clear it */ }
  }
  // A successful turn closes any retry card still waiting on the human.
  if (status === 'succeeded') {
    try {
      for (const d of deps().decisions.list({ status: ['open'], ticketId: f.agent.ticketId ?? undefined })) {
        if (d.kind === 'retry_approval' && (d.target as { agentId?: string } | null)?.agentId === f.agent.id) deps().decisions.withdraw({ kind: 'system', id: null }, d.id, 'the worker recovered');
      }
    } catch { /* best effort */ }
  }
  // VS-137: the conductor's per-ticket notice that this ticket's worker paused for a runtime login
  // outage is withdrawn the next time that worker finishes a turn that is not itself another auth
  // failure — success or an unrelated failure both mean the outage is no longer why this ticket
  // looks stalled. A further auth failure leaves it open; `gateRuntimeForLogin` keeps it to one card.
  if (errorFamily !== 'auth' && f.agent.ticketId) {
    try {
      const key = `auth-outage:${f.agent.ticketId}`;
      for (const d of deps().decisions.list({ status: ['open'], ticketId: f.agent.ticketId })) {
        if (d.correlationKey === key) deps().decisions.withdraw({ kind: 'system', id: null }, d.id, 'the ticket moved again');
      }
    } catch { /* best effort */ }
  }

  // Three consecutive empty turns on non-digest wakes is a gate finding for the conductor (PLAN §9.4).
  if (liveness === 'empty' && f.agent.kind === 'worker') {
    const recent = ctx.db.all<{ liveness: string }>("SELECT liveness FROM runs WHERE agent_id = ? AND status = 'succeeded' ORDER BY created_at DESC LIMIT 3", [f.agent.id]);
    if (recent.length === 3 && recent.every((x) => x.liveness === 'empty')) {
      try {
        deps().decisions.create({ kind: 'system', id: null }, {
          ticketId: f.agent.ticketId, kind: 'gate_finding', owner: 'conductor',
          title: `${f.agent.name} produced three empty turns in a row`,
          context: 'The worker ended three consecutive turns without advancing its ticket. Steer it, relaunch it, or cancel the ticket.',
          correlationKey: `empty-turns:${f.agent.id}`,
        });
      } catch { /* decisions service may be unavailable; the supervisor will notice again */ }
    }
  }

  log.info({ status, liveness, turnEpoch: f.run.turnEpoch, agentId: f.agent.id }, 'run finished');
  return finalRun;
}

/**
 * How many automatic attempts have already been made on this piece of work, by walking the chain of
 * `retry_of_run_id` links the dispatcher records at claim time. The 10-hop cap is a guard: a cycle in
 * the data must not spin here.
 */
export function countRetries(ctx: WorkspaceContext, runId: string): number {
  let n = 0;
  let cur: string | null = runId;
  while (cur && n < 10) {
    const row: { retryOfRunId: string | null } | undefined = ctx.db.get<{ retryOfRunId: string | null }>('SELECT retry_of_run_id FROM runs WHERE id = ?', [cur]);
    cur = row?.retryOfRunId ?? null;
    if (cur) n += 1;
  }
  return n;
}

/**
 * The system will not attempt this work again by itself — the automatic retries are spent, the
 * failure is not retryable, or the runtime reported a usage limit, which never enters the ladder.
 * Stop burning turns, record why the worker stopped, and put the question to the human as a decision
 * on the ticket. Nothing is scheduled here: the worker stays parked, spending nothing, until the
 * human answers (VS-56 — the previous version booked a quota retry the human had not asked for).
 */
function parkForHuman(ctx: WorkspaceContext, deps: () => CoreServices, f: FinalizeInput, family: RunErrorFamily | null, code: string | null, message: string | null): void {
  const log = ctx.log('run').child({ runId: f.run.id });
  const ticketId = f.agent.ticketId;
  const quota = family === 'provider_quota';
  const resetAt = quota ? parseResetTime(message ?? '') : null;
  // Each step is guarded on its own: parking is the last thing that happens before a human has to
  // notice by hand, so one step failing must not take the others with it, and none of it may fail
  // quietly. VS-49: the decision could not be stored at all, and the single try that used to wrap
  // this left the ticket unblocked and the quota retry unbooked behind one warn line.
  const step = (name: string, fn: () => void): void => {
    try { fn(); } catch (e) { log.error({ err: String(e), step: name, agentId: f.agent.id, ticketId }, `parking the worker for the human failed at ${name}`); }
  };

  step('pause the agent', () => {
    ctx.db.update('agents', f.agent.id, {
      status: 'paused',
      pauseReason: `${code ?? family ?? 'failed'}: waiting for a human`,
      // The structured twin of that line: what every surface reads to name the family and the
      // runtime's own words without joining runs or a decision that may not exist.
      pauseDetailJson: {
        family: family ?? null, code: code ?? null,
        message: message ? message.slice(0, 400) : null,
        resetAt: resetAt ? resetAt.toISOString() : null, runId: f.run.id,
      },
      updatedAt: nowIso(),
    });
  });

  let identifier: { identifier: string; status: string } | undefined;
  step('read the ticket', () => {
    identifier = ticketId ? ctx.db.get<{ identifier: string; status: string }>('SELECT identifier, status FROM tickets WHERE id = ?', [ticketId]) : undefined;
  });

  let raised = false;
  step('raise the decision', () => {
    // No per-runtime options (VS-77): answering one used to write this agent's own runtime, which is
    // the override the two settings replaced. Where the runtime is the problem, the way out is the
    // workspace setting, so the card names it instead of offering to change it for one worker.
    const runtime = f.run.runtimeId;
    const setting = f.agent.kind === 'conductor' ? 'models.conductor' : 'models.workers';
    deps().decisions.create({ kind: 'system', id: null }, {
      kind: 'retry_approval', owner: 'human', ticketId: ticketId ?? null,
      title: quota
        ? `${f.agent.name} hit the ${runtime} usage limit${identifier ? ` on ${identifier.identifier}` : ''}`
        : `${f.agent.name} failed${identifier ? ` on ${identifier.identifier}` : ''}: ${code ?? family ?? 'unknown error'}`,
      context: [
        `Failure: ${family ?? 'unknown'}${code ? ` (${code})` : ''}`,
        message ? `Last error: ${message.slice(0, 400)}` : null,
        quota
          ? `${resetAt ? `The runtime says the limit resets at ${fmtUtc(resetAt)} UTC. ` : ''}A usage limit is not retried automatically, so nothing will run until you answer: retry now, ${resetAt ? 'retry when it resets' : 'retry in an hour'}, or cancel.`
          : 'Automatic retries are spent. Retry or cancel the ticket.',
        `This ran on ${runtime}. The runtime is the workspace's ${setting} setting — change it there and retry, and every ${f.agent.kind === 'conductor' ? 'conductor turn' : 'worker'} follows.`,
        'Retrying resumes the same session on the same branch.',
      ].filter(Boolean).join('\n\n'),
      options: [
        { key: 'retry', label: 'Retry now', recommended: !quota },
        resetAt
          ? { key: 'retry_at_reset', label: `Retry when the limit resets (${fmtUtc(resetAt)} UTC)`, recommended: true }
          : { key: 'retry_1h', label: 'Retry in an hour', recommended: quota },
        { key: 'cancel', label: 'Cancel the ticket' },
      ],
      recommendation: quota ? (resetAt ? 'retry_at_reset' : 'retry_1h') : 'retry',
      correlationKey: `retry:${f.agent.id}`,
      target: { agentId: f.agent.id, ticketId: ticketId ?? null, runtime, family, code, resetAt: resetAt ? resetAt.toISOString() : null },
    });
    raised = true;
  });

  step('block the ticket', () => {
    if (!ticketId || !identifier || ['blocked', 'done', 'cancelled', 'backlog'].includes(identifier.status)) return;
    // `blocked` needs a routable path: the open card is that path, so it is only when the card could
    // not be raised that this has to spell the way out itself. Without it the transition is refused
    // and a stuck worker's ticket stays in the status it was working in.
    void deps().tickets.transition({ kind: 'system', id: null }, ticketId, {
      to: 'blocked',
      note: `${f.agent.name} is parked after ${code ?? family}; waiting for you`,
      ...(raised ? {} : { unblock: { owner: 'human' as const, action: `${f.agent.name} is parked after ${code ?? family} and its retry card could not be raised — relaunch it, move it to another runtime, or cancel the ticket.` } }),
    }).catch((e: unknown) => log.error({ err: String(e), step: 'block the ticket', agentId: f.agent.id, ticketId }, 'parking the worker for the human failed at block the ticket'));
  });

}

/** `2026-09-05 14:30` — the card and its options name a reset time the same way. */
function fmtUtc(at: Date): string {
  return at.toISOString().slice(0, 16).replace('T', ' ');
}

/** "resets at 3pm", "resets at 15:30", "reset in 2 hours", "try again in 45 minutes" → a Date, else null. */
export function parseResetTime(message: string, now = new Date()): Date | null {
  const m = message.toLowerCase();
  let r = /(?:reset|resets|try again|available)\s+in\s+(\d+)\s*(hour|hr|minute|min|second|sec)/.exec(m);
  if (r) {
    const n = Number(r[1]); const unit = r[2]!;
    const ms = unit.startsWith('h') ? n * 3_600_000 : unit.startsWith('m') ? n * 60_000 : n * 1000;
    return new Date(now.getTime() + ms);
  }
  r = /resets?\s+(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/.exec(m);
  if (r) {
    let h = Number(r[1]); const min = Number(r[2] ?? 0);
    if (r[3] === 'pm' && h < 12) h += 12;
    if (r[3] === 'am' && h === 12) h = 0;
    const at = new Date(now); at.setHours(h, min, 0, 0);
    if (at.getTime() <= now.getTime()) at.setDate(at.getDate() + 1);
    return at;
  }
  return null;
}
