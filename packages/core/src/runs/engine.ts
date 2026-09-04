import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { nowIso } from '@openconductor/db';
import {
  OC_ENV, RUN_REPORT_JSON_SCHEMA, RunReportSchema, extractReport, estimateCostCents,
  type Agent, type Role, type Project, type Run, type RunEvent, type RunErrorFamily, type RunLiveness,
  type RunPhase, type RunReport, type Ticket, type Wakeup, type SessionPolicy, type PermissionMode,
} from '@openconductor/shared';
import type { McpServerConfig, RuntimeEvent, TurnHandle, TurnInput, TurnResult } from '@openconductor/runtime-sdk';
import type { WorkspaceContext } from '../context.js';
import type { CoreServices } from '../api.js';
import { createSessions, type SessionsService } from '../sessions/index.js';
import { buildTurnPrompt, type TurnPromptOptions } from '../prompts/index.js';
import { ensureHomeCurrent } from '../workers/home.js';
import { recordUsage } from '../usage/index.js';
import { git } from '../util/git.js';
import { emitRunEvent, runState } from './active.js';
import { runTokenSecret, signRunToken } from './runtoken.js';

const PAYLOAD_LIMIT = 8 * 1024;
const RETRY_BACKOFF_MS = [30_000, 120_000, 600_000];
const RETRYABLE: RunErrorFamily[] = ['transient_upstream', 'provider_quota'];

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

function roleSecretsEnv(ctx: WorkspaceContext, role: Role | null): { env: Record<string, string>; values: string[] } {
  const env: Record<string, string> = {};
  const values: string[] = [];
  for (const name of role?.secrets ?? []) {
    const secret = ctx.db.get<{ envVarName: string }>('SELECT env_var_name FROM secrets WHERE workspace_id = ? AND name = ?', [ctx.workspaceId, name]);
    const varName = secret?.envVarName ?? name;
    const value = process.env[varName];
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

  ctx.db.update('runs', runId, { status: 'running', startedAt: nowIso() });
  ctx.db.update('agents', agent.id, { status: 'running', updatedAt: nowIso() });
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
    const turnSession = sessions.forTurn({ id: agent.id, kind: agent.kind, runtimeId: agent.runtimeId }, policy);
    promptOptions = { ...promptOptions, isFirstTurn: promptOptions.isFirstTurn ?? turnSession.isFirstTurn, sessionStale: turnSession.stale, turnEpoch: run.turnEpoch };
    const prompt = await phase('build_prompt', async () => {
      const text = await buildTurnPrompt(ctx, deps, agent, wakes, promptOptions);
      writeFileSync(join(runDir, 'prompt.md'), text, 'utf8');
      return text;
    });

    // 4. run token + MCP config + env
    const token = await mintRunToken(ctx, { agentId: agent.id, runId, ticketId: agent.ticketId, kind: agent.kind, projectId: agent.projectId, roleId: agent.roleId });
    const mcpServers: Record<string, McpServerConfig> = {
      openconductor: { type: 'http', url: `${ctx.loopbackUrl.replace(/\/$/, '')}/mcp/runs/${runId}`, headers: { Authorization: `Bearer ${token}` } },
    };
    writeFileSync(join(runDir, 'mcp.json'), JSON.stringify({ mcpServers }, null, 2), 'utf8');

    const secrets = roleSecretsEnv(ctx, role);
    redact = makeRedactor([token, ...secrets.values]);
    const env: Record<string, string> = {
      [OC_ENV.API_URL]: ctx.loopbackUrl,
      [OC_ENV.RUN_TOKEN]: token,
      [OC_ENV.RUN_ID]: runId,
      [OC_ENV.AGENT_ID]: agent.id,
      [OC_ENV.AGENT_KIND]: agent.kind,
      [OC_ENV.WORKSPACE_ID]: ctx.workspaceId,
      [OC_ENV.WAKE_REASON]: wakes.map((w) => `${w.source}:${w.reason}`).join('; ').slice(0, 400),
      ...(agent.roleId ? { [OC_ENV.ROLE_ID]: agent.roleId } : {}),
      ...(agent.projectId ? { [OC_ENV.PROJECT_ID]: agent.projectId } : {}),
      ...(agent.ticketId ? { [OC_ENV.TICKET_ID]: agent.ticketId } : {}),
      ...(agent.worktreePath ? { [OC_ENV.WORKTREE]: agent.worktreePath } : {}),
      ...secrets.env,
    };

    const runtime = ctx.registries.runtimes.get(agent.runtimeId);
    if (!runtime) throw Object.assign(new Error(`runtime ${agent.runtimeId} is not registered`), { ocFamily: 'tooling' as RunErrorFamily, ocCode: 'runtime_unreachable' });

    const permission = (role?.permission ?? {}) as { mode?: PermissionMode; allowed?: string[]; denied?: string[] };
    const instructionsPath = join(agent.homePath, 'AGENTS.md');
    let systemPromptText = '';
    try { systemPromptText = readFileSync(instructionsPath, 'utf8'); } catch { systemPromptText = ''; }

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
      options: {},
      limits: { timeoutMs: (ctx.config.defaults.turnTimeoutSec ?? 2700) * 1000 },
      permission: { mode: permission.mode ?? ctx.config.defaults.permissionMode ?? 'auto', allowedTools: permission.allowed, deniedTools: permission.denied },
      model: agent.model ?? role?.model ?? ctx.config.defaults.model ?? null,
      effort: agent.effort ?? role?.effort ?? null,
      configHome: join(ctx.paths.runtimesHome, agent.runtimeId),
    };

    // 5. spawn + stream
    result = await phase('turn', async () => runtime.runTurn(
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
        if (existing) existing.cancel = (mode) => handle.cancel(mode);
      },
    ));
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
  if (f.cancelled) { status = 'cancelled'; errorCode = errorCode ?? 'cancelled'; errorFamily = errorFamily ?? 'tooling'; }

  const usage = r?.usage ?? null;
  const model = r?.model ?? f.agent.model ?? f.role?.model ?? null;
  let costCents: number | null = null;
  let costStatus: 'reported' | 'estimated' | 'unpriced' = 'unpriced';
  if (r?.cost && typeof r.cost.usd === 'number') { costCents = Math.round(r.cost.usd * 100); costStatus = r.cost.status === 'reported' ? 'reported' : 'estimated'; }
  else if (usage) {
    const est = estimateCostCents(model, { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, cachedInputTokens: usage.cachedInputTokens }, ctx.config.pricingOverrides);
    if (est !== null) { costCents = est; costStatus = 'estimated'; }
  }
  const liveness = classifyLiveness(status, f.report, f.ticket?.status ?? null);
  const summary = f.report?.summary ?? (r?.finalText ? r.finalText.slice(0, 1000) : f.failure?.message ?? null);

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
      updatedAt: now,
    });

    for (const w of f.wakes) {
      ctx.db.update('wakeups', w.id, { status: status === 'succeeded' ? 'completed' : 'failed', runId, finishedAt: now });
    }

    if (f.ticket) ctx.db.run('UPDATE tickets SET execution_run_id = NULL, execution_locked_at = NULL WHERE id = ? AND execution_run_id = ?', [f.ticket.id, runId]);

    if (usage) {
      recordUsage(ctx, {
        agentId: f.agent.id, runId, runtimeId: f.agent.runtimeId, projectId: f.agent.projectId, roleId: f.agent.roleId,
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

  // Retry the transient families with backoff (30 s / 2 min / 10 min, max 3).
  if (errorFamily && RETRYABLE.includes(errorFamily)) {
    const attempt = countRetries(ctx, runId);
    if (attempt < RETRY_BACKOFF_MS.length) {
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
    }
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

function countRetries(ctx: WorkspaceContext, runId: string): number {
  let n = 0;
  let cur: string | null = runId;
  while (cur && n < 10) {
    const row: { retryOfRunId: string | null } | undefined = ctx.db.get<{ retryOfRunId: string | null }>('SELECT retry_of_run_id FROM runs WHERE id = ?', [cur]);
    cur = row?.retryOfRunId ?? null;
    if (cur) n += 1;
  }
  return n;
}
