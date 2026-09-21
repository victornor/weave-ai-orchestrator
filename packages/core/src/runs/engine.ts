import { credentialReaderFor, reconcileRuntimeCredential } from '../workspace/loader.js';
import { gateRuntimeForLogin, ungateRuntime } from './authgate.js';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { nowIso } from '@weave-ai/db';
import {
  AC_ENV, RUN_REPORT_JSON_SCHEMA, RunReportSchema, extractReport, estimateCostCents, OcError, landingBranchOf,
  isWorkerOptionConfigured, isProgressRunEvent, MCP_SERVER_NAME, PLANNER_TOOLS, FIRST_TURN_TOOLS,
  TERMINAL_TICKET_STATUSES, resolveWorkerMemoryMb,
  type Agent, type AgentKind, type Role, type Project, type Run, type RunEvent, type RunErrorFamily, type RunLiveness,
  type RunPhase, type RunReport, type Ticket, type Wakeup, type SessionPolicy, type PermissionMode, type McpServer,
} from '@weave-ai/shared';
import type { ContainmentRequest, McpServerConfig, RuntimeEvent, TurnHandle, TurnInput, TurnResult } from '@weave-ai/runtime-sdk';
import { readScopeMemoryPeak, releaseScope, scopeUnitName, systemdScopeAvailable, truncate } from '@weave-ai/runtime-sdk';
import { baseMemoryMb } from './memory.js';
import { recordActivity } from '../events.js';
import type { WorkspaceContext } from '../context.js';
import type { CoreServices } from '../api.js';
import { createSessions, type SessionsService } from '../sessions/index.js';
import { buildTurnPrompt, flattenWakes, type TurnPromptOptions } from '../prompts/index.js';
import { ensureHomeCurrent } from '../workers/home.js';
import { agentNeedsCheckout } from '../workers/index.js';
import { recordUsage } from '../usage/index.js';
import { git, readGitIdentity } from '../util/git.js';
import { emitRunEvent, runState } from './active.js';
import { PartialBuffer } from './partials.js';
import { effectiveModels, modelSettingFor, modelsFor } from '../models/resolve.js';
import { runTokenSecret, signRunToken } from './runtoken.js';
import { effectiveMcpServers, effectiveProviders, scopedSecretValue } from '../scoped.js';

/**
 * An interactive session's agent's first turn (VS-101, VS-462): read the ticket and its comments,
 * post one comment, nothing else. These are the MCP tool names; `weave_ticket_comment` is included
 * because the requirement is not silence, it is stating what the agent understands and is ready to
 * do. Passed to the runtime's own allowlist where it has one, and enforced at the MCP boundary from
 * the run token's `firstTurn` claim where it does not.
 */
export const FIRST_TURN_ALLOWLIST: string[] = [...FIRST_TURN_TOOLS];

/**
 * A planning agent's entire turn (VS-398): read-only, enforced by the runtime's own `--allowedTools`
 * for the whole session, not just the first turn — `PLANNER_TOOLS` plus the built-in read tools it
 * needs to read its disposable worktree. No `Write`/`Edit`/`NotebookEdit`/`Bash`/… is ever reachable.
 */
export const PLANNER_ALLOWLIST = [...PLANNER_TOOLS, 'Read', 'Grep', 'Glob'];

const PAYLOAD_LIMIT = 8 * 1024;
const RETRY_BACKOFF_MS = [30_000, 120_000, 600_000];

/**
 * VS-579: the parallelism a worker's test runner may use by default. A full suite that otherwise
 * takes one worker per core is what took the daemon down on 2026-09-19; these are only defaults,
 * filled for keys the daemon environment does not already set, and a project's own command-line
 * value still wins because it is set in the child shell.
 */
export function testParallelismDefaults(env: Record<string, string | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  if (env['VITEST_MAX_WORKERS'] === undefined) out['VITEST_MAX_WORKERS'] = '4';
  if (env['VITEST_MAX_THREADS'] === undefined) out['VITEST_MAX_THREADS'] = '4';
  if (env['UV_THREADPOOL_SIZE'] === undefined) out['UV_THREADPOOL_SIZE'] = '4';
  return out;
}
/**
 * The families the system retries by itself. `provider_quota` is deliberately absent (VS-56, ADR
 * 0010): a usage limit is not transient the way an upstream 503 is — the runtime has already said
 * the window is exhausted — so the ladder could only fail three more times at rising cost before
 * reaching the same card. A quota failure parks the worker on its first occurrence instead.
 */
export const RETRYABLE: RunErrorFamily[] = ['transient_upstream', 'resource'];

/** VS-579: the run error code a worker killed for exceeding its memory limit carries. */
export const WORKER_MEMORY_ERROR_CODE = 'worker_memory_limit';
/** How close to the limit a scope's peak must be before an unattributed SIGKILL is read as memory. */
const MEMORY_KILL_PEAK_RATIO = 0.9;

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

// ---------- MCP servers (VS-621) ----------

/**
 * The MCP servers a `weave` run may use, from the workspace definitions its role (or the weaver)
 * allows. Every `${SECRET_NAME}` in an `env` or `headers` value is resolved from the workspace
 * secret store; the resolved values are returned for redaction and never stored in the definitions
 * view that `mcp.json` records. A server with a reference that resolves to nothing is omitted whole,
 * so it never starts unauthenticated.
 */
export function buildMcpServers(input: {
  configServers: Record<string, McpServer>;
  allowed: string[];
  resolveSecret: (name: string) => string | null;
}): { servers: Record<string, McpServerConfig>; definitions: Record<string, McpServerConfig>; secretValues: string[]; missing: string[]; unknown: string[] } {
  const servers: Record<string, McpServerConfig> = {};
  const definitions: Record<string, McpServerConfig> = {};
  const secretValues: string[] = [];
  const missing: string[] = [];
  const unknown: string[] = [];
  for (const name of [...new Set(input.allowed)]) {
    const cfg = input.configServers[name];
    if (!cfg) { unknown.push(name); continue; }
    const serverMissing = new Set<string>();
    const resolve = (value: string): string => value.replace(/\$\{([^}]*)\}/g, (_m, ref: string) => {
      const secret = input.resolveSecret(ref);
      if (secret == null) { serverMissing.add(ref); return ''; }
      secretValues.push(secret);
      return secret;
    });
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(cfg.env)) env[k] = resolve(v);
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(cfg.headers)) headers[k] = resolve(v);
    if (serverMissing.size > 0) { for (const ref of serverMissing) missing.push(`${name}:${ref}`); continue; }
    const timeouts = { listTimeoutMs: cfg.listTimeoutMs, callTimeoutMs: cfg.callTimeoutMs, readOnly: cfg.readOnly };
    if (cfg.type === 'stdio') {
      servers[name] = { type: 'stdio', command: cfg.command ?? '', args: cfg.args, env, ...timeouts };
      definitions[name] = { type: 'stdio', command: cfg.command ?? '', args: cfg.args, env: cfg.env, ...timeouts };
    } else {
      servers[name] = { type: 'http', url: cfg.url ?? '', headers, ...timeouts };
      definitions[name] = { type: 'http', url: cfg.url ?? '', headers: cfg.headers, ...timeouts };
    }
  }
  return { servers, definitions, secretValues, missing, unknown };
}

/** The `mcp.json` debug view: the run token's `Authorization` value (the only real secret in it) is scrubbed. */
function redactMcpJson(servers: Record<string, McpServerConfig>): Record<string, McpServerConfig> {
  const out: Record<string, McpServerConfig> = {};
  for (const [name, cfg] of Object.entries(servers)) {
    if (!cfg.headers) { out[name] = cfg; continue; }
    const headers = Object.fromEntries(Object.entries(cfg.headers).map(([k, v]) => [k, /^authorization$/i.test(k) ? '[redacted]' : v]));
    out[name] = { ...cfg, headers };
  }
  return out;
}

function boundPayload(payload: unknown): Record<string, unknown> {
  const obj = (payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : { value: payload }) as Record<string, unknown>;
  const text = JSON.stringify(obj);
  if (text.length <= PAYLOAD_LIMIT) return obj;
  return { truncated: true, bytes: text.length, preview: text.slice(0, PAYLOAD_LIMIT - 200) };
}

// ---------- run token ----------

/** Mint the run's MCP bearer token (PLAN §9.1); the claim shape lives in runtoken.ts. */
export async function mintRunToken(ctx: WorkspaceContext, claims: { agentId: string; runId: string; ticketId: string | null; planId: string | null; kind: AgentKind; projectId: string | null; roleId: string | null; firstTurn?: boolean }): Promise<string> {
  return signRunToken(runTokenSecret(ctx.db), {
    workspaceId: ctx.workspaceId, runId: claims.runId, agentId: claims.agentId,
    agentKind: claims.kind,
    projectId: claims.projectId, ticketId: claims.ticketId, planId: claims.planId, roleId: claims.roleId,
    firstTurn: claims.firstTurn ?? false,
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

/**
 * VS-619: the value of the provider secret the run's model names, held in the run's own workspace
 * store — for redaction only. The adapter reads the same secret through `RuntimeHost.providerKey`;
 * the engine never passes it to the child. `undefined` when the model names no configured provider,
 * its profile carries no `apiKeySecret`, or the store holds no value.
 */
function providerStoreKey(ctx: WorkspaceContext, deps: () => CoreServices, model: string | null | undefined): string | undefined {
  const providerId = model?.split('/')[0];
  if (!providerId || providerId === model) return undefined;
  const profile = effectiveProviders(ctx)[providerId];
  if (!profile?.apiKeySecret) return undefined;
  return scopedSecretValue(ctx, (n) => deps().secrets.value(n), profile.apiKeySecret) ?? undefined;
}

function classifyLiveness(status: Run['status'], report: RunReport | null, ticketStatus: string | null): RunLiveness {
  if (status !== 'succeeded') return 'failed';
  if (!report) return 'empty';
  switch (report.state) {
    case 'needs_decision': return 'needs_decision';
    case 'blocked': return 'blocked';
    case 'failed': return 'failed';
    case 'idle': return 'idle';
    case 'working': return ticketStatus === 'proposing' || ticketStatus === 'proposed' ? 'plan_only' : 'advanced';
    default: return 'advanced';
  }
}

/**
 * Ticket statuses in which a worker is correctly waiting on someone else rather than expected to
 * act on its own (VS-145): a plan awaiting approval, a delivered PR awaiting review/merge, or a
 * blocker only its owner can clear. A run that finishes while its ticket is in one of these never
 * counts toward the stuck-worker gate, whatever it reported.
 */
const TICKET_STATUSES_NOT_EXPECTING_ACTION = new Set(['proposed', 'in_review', 'blocked']);

/**
 * VS-338: the wakes that deliberately put a worker back on its ticket, so a `{owner, action}` block
 * they carried is resolved. A generic `system` digest, a `self_scheduled` self-check, a `routine`
 * fire or a system-booked `retry` must NOT reopen a blocked ticket — the board would churn and, for
 * a `weaver`-owned block, the weaver would be woken on every tick. A resume and a relaunch count: a
 * person or the system explicitly asked for the worker to continue.
 */
const RESOLVING_WAKE_SOURCES: ReadonlySet<string> = new Set(['decision_answered', 'conductor_request', 'human_message', 'live_interrupt']);

function wakeResolvesBlock(
  w: { source: string; requestedByKind: string; payload: Record<string, unknown> },
  ticketId: string,
): boolean {
  if (RESOLVING_WAKE_SOURCES.has(w.source)) {
    // A decision answered elsewhere must not reopen this ticket; one with no ticket is the worker's own.
    if (w.source === 'decision_answered') {
      const onTicket = w.payload['ticketId'];
      if (onTicket != null && onTicket !== ticketId) return false;
    }
    return true;
  }
  if (w.source === 'ticket_comment' || w.source === 'retry') return w.requestedByKind === 'human';
  if (w.source === 'system') return w.payload['resumed'] === true || typeof w.payload['relaunchNote'] === 'string';
  return false;
}

/** Whether any wake this run claimed (a coalesced bundle included) resolves a block on `ticketId`. */
function runResolvesBlock(wakes: Wakeup[], ticketId: string): boolean {
  return flattenWakes(wakes).some((w) => wakeResolvesBlock(w, ticketId));
}

/** Tables carrying the authoring run's id for a durable, ticket-facing artifact a turn can produce. */
const EVIDENCE_TABLES = ['ticket_comments', 'ticket_document_revisions', 'ticket_work_products', 'knowledge_revisions'] as const;

/**
 * Whether a finished run left any observable trace of progress on its ticket, independent of
 * whether its own terminal report happened to parse (VS-145): a comment, a document revision, a
 * work product, a knowledge write, or a logged ticket transition — all already keyed by `run_id`
 * with no schema change needed. `recordActivity` (`core/src/events.ts`) logs `ticket.transition`
 * under the acting run's id on every status change, note or not, so that alone also answers "did the
 * ticket's status move during this run" without needing a before/after snapshot.
 */
export function runProducedEvidence(ctx: WorkspaceContext, runId: string, ticketId: string | null): boolean {
  if (!ticketId) return false;
  for (const table of EVIDENCE_TABLES) {
    if (ctx.db.get(`SELECT 1 FROM ${table} WHERE run_id = ? LIMIT 1`, [runId])) return true;
  }
  // Scoped to an actual status change, not just any activity row this run happens to have logged —
  // `recordUsage` (packages/core/src/usage/service.ts) logs a `usage.recorded` activity row against
  // the ticket for every successful run with usage, which would otherwise match every turn.
  return Boolean(ctx.db.get(
    "SELECT 1 FROM activity WHERE run_id = ? AND ticket_id = ? AND action = 'ticket.transition' LIMIT 1",
    [runId, ticketId],
  ));
}

/**
 * The ticket's status as of a given moment, reconstructed from its own history rather than a stored
 * per-run snapshot (there is none): the most recent `ticket.transition` or `ticket.create` activity
 * row at or before that time names the status it was in — `ticket.create`'s own `details.status`
 * anchors a ticket that had not yet transitioned by that point, so a later transition can never
 * retroactively make an earlier run look like it happened on the ticket's current status. Only a
 * ticket with no creation record at all (a raw seed, never `tickets.create()`) falls back to reading
 * its current status live.
 */
function ticketStatusAsOf(ctx: WorkspaceContext, ticketId: string, atIso: string): string | null {
  // `Db.get`/`Db.all` decode a `*_json` column and drop its suffix (`packages/db/src/db.ts` `camel`),
  // so the row comes back as `{ details: {...} }`, already parsed — not a `detailsJson` string.
  const last = ctx.db.get<{ details: { to?: string; status?: string } | null }>(
    "SELECT details_json FROM activity WHERE ticket_id = ? AND action IN ('ticket.transition', 'ticket.create') AND created_at <= ? ORDER BY created_at DESC, rowid DESC LIMIT 1",
    [ticketId, atIso],
  );
  const status = last?.details?.to ?? last?.details?.status;
  if (status) return status;
  return ctx.db.get<{ status: string }>('SELECT status FROM tickets WHERE id = ?', [ticketId])?.status ?? null;
}

function sessionPolicyFor(agent: Agent, role: Role | null): SessionPolicy {
  if (agent.kind === 'weaver' || agent.kind === 'planner' || agent.kind === 'session') return 'persistent';
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
  let redactionSecrets: string[] = [];
  // VS-595: partial output is ephemeral and redacted like any persisted event (see `partials.ts`).
  const partials = new PartialBuffer({
    runId,
    emit: (frame) => { try { ctx.events.broadcast('run.delta', 'run', runId, frame); } catch (e) { log.warn({ err: String(e) }, 'run delta broadcast failed'); } },
    redact: (text) => redact(text) as string,
    secrets: () => redactionSecrets,
  });
  state.partials.set(runId, partials);
  const record = (type: RunEvent['type'], payload: Record<string, unknown>, stream: 'stdout' | 'stderr' | 'runtime' | 'system' = 'runtime', level = 'info'): void => {
    seq += 1;
    const ts = nowIso();
    const clean = redact(payload) as Record<string, unknown>;
    try {
      ctx.db.run('INSERT INTO run_events (run_id, seq, ts, type, stream, level, payload_json) VALUES (?,?,?,?,?,?,?)', [runId, seq, ts, type, stream, level, JSON.stringify(boundPayload(clean))]);
      // VS-461: the silence window is measured from `last_progress_at`, not `last_event_at` — a retry
      // loop re-emits session/step-boundary events without doing any work, and those must not reset it.
      if (isProgressRunEvent(type)) {
        ctx.db.run('UPDATE runs SET last_event_at = ?, last_progress_at = ? WHERE id = ?', [ts, ts, runId]);
      } else {
        ctx.db.run('UPDATE runs SET last_event_at = ? WHERE id = ?', [ts, runId]);
      }
      // The run's own error text, so the provider's words survive the turn and are readable from the
      // run view (the transcript reads the `error` event; this reads the row).
      if (type === 'error' && typeof clean['message'] === 'string') {
        ctx.db.run('UPDATE runs SET last_error = ? WHERE id = ?', [truncate(clean['message'], 4000), runId]);
      }
    } catch (e) { log.warn({ err: String(e) }, 'failed to persist run event'); }
    try { appendFileSync(eventsPath, JSON.stringify({ seq, ts, type, stream, payload: clean }) + '\n', 'utf8'); } catch { /* disk full etc; the DB row is authoritative */ }
    const ev: RunEvent = { id: String(seq), runId, seq, ts, type, stream, level, payload: clean };
    emitRunEvent(ctx, runId, ev);
    // VS-595: the completed part supersedes its partial output.
    if ((type === 'assistant.text' || type === 'assistant.thinking' || type === 'tool.call' || type === 'tool.result') && typeof clean['partId'] === 'string') partials.complete(clean['partId']);
    // VS-328: fold the event into the live per-worker activity summary the board consumes.
    try { deps().activity.observe(agent.id, agent.ticketId ?? null, ev); } catch (e) { log.warn({ err: String(e) }, 'activity observe failed'); }
  };

  const phase = async <T>(name: RunPhase, fn: () => Promise<T>): Promise<T> => {
    const t0 = Date.now();
    try { return await fn(); } finally { record('run.phase.timing', { phase: name, ms: Date.now() - t0 }, 'system'); }
  };

  // The one place a turn's runtime, model and effort come from (VS-77). The agent row records the
  // runtime it is on so the worker pages and the account probe can read it; it is corrected here
  // rather than consulted, so a stale row can never decide what this turn launches.
  let setting;
  try {
    setting = modelSettingFor(modelsFor(ctx), agent.kind, ticket, agent);
  } catch (e) {
    if (!(e instanceof OcError) || e.code !== 'model_unconfigured') throw e;
    ctx.events.emit('run.started', 'run', runId, { agentId: agent.id, ticketId: agent.ticketId, turnEpoch: run.turnEpoch });
    record('run.started', { agentId: agent.id, turnEpoch: run.turnEpoch, wakeups: run.wakeupIds ?? [] }, 'system');
    record('error', { message: e.message, code: e.code }, 'system', 'error');
    const finished = finalize(ctx, deps, sessions, {
      run, agent, role, project, ticket, wakes, result: null,
      failure: { code: e.code, family: 'tooling', message: e.message },
      report: null, durationMs: Date.now() - started, sessionId: null,
      cancelled: null, record,
    });
    await afterTurnHooks(ctx, deps, agent, ticket);
    return finished;
  }

  // VS-256: a curation turn fact-checks the knowledge base against the project's primary clone —
  // the only checkout it has (it is always spawned `noWorktree`). That clone is otherwise only kept
  // current by the hourly reconcile sweep, whose own fast-forward failures are silently logged
  // (VS-131); without this gate a curation turn can run against a clone that is arbitrarily stale and
  // remove a knowledge entry as "contradicted" by evidence that was simply behind (VS-255). Checked
  // on every turn, not only the first, so a relaunch or a later turn on the same ticket is covered
  // the same way (design.md Decision 3 of vs-256-curation-fact-checks-against-a-stale-che).
  if (ticket?.originKind === 'curation' && project) {
    let freshnessError: string | null = null;
    try {
      await deps().projects.fetch(project.id);
      const row = ctx.db.get<Project>('SELECT * FROM projects WHERE id = ?', [project.id]);
      if (!row || row.syncState !== 'in_sync') {
        freshnessError = `primary clone for ${project.slug} has diverged from origin/${landingBranchOf(row ?? project, ticket)} and could not be fast-forwarded`;
      } else {
        Object.assign(project, row);
      }
    } catch (e) {
      freshnessError = `could not fetch origin for ${project.slug}'s primary clone: ${String(e)}`;
    }
    if (freshnessError) {
      ctx.events.emit('run.started', 'run', runId, { agentId: agent.id, ticketId: agent.ticketId, turnEpoch: run.turnEpoch });
      record('run.started', { agentId: agent.id, turnEpoch: run.turnEpoch, wakeups: run.wakeupIds ?? [] }, 'system');
      record('error', { message: freshnessError, code: 'checkout_stale' }, 'system', 'error');
      try {
        await deps().tickets.transition({ kind: 'system', id: null }, ticket.id, {
          to: 'blocked',
          unblock: {
            owner: 'weaver',
            action: `curation for ${project.slug} needs a checkout verified current before it can run safely — ${freshnessError}. Bring the primary clone in sync, then retry curation.`,
          },
        });
      } catch (e) {
        log.warn({ err: String(e) }, 'could not transition curation ticket to blocked after a checkout freshness failure');
      }
      const finished = finalize(ctx, deps, sessions, {
        run, agent, role, project, ticket, wakes, result: null,
        failure: { code: 'checkout_stale', family: 'tooling', message: freshnessError },
        report: null, durationMs: Date.now() - started, sessionId: null,
        cancelled: null, record,
      });
      await afterTurnHooks(ctx, deps, agent, ticket);
      return finished;
    }
  }

  // VS-338: a resolving wake starting this turn means the `{owner, action}` block on the ticket was
  // answered — return it to the work it was doing before the turn does anything, so the status
  // event, activity and board record it. Placed after the curation gate so a ticket that gate blocks
  // stays blocked, and keyed to the wake so a timer or self-check does not churn a still-blocked
  // ticket.
  if (ticket?.status === 'blocked' && runResolvesBlock(wakes, ticket.id)) {
    const restored = await deps().tickets.resumeIfBlocked(
      { kind: 'system', id: null }, ticket.id, `${agent.name} resumed after the block was answered`,
    );
    // finalize reads this object for the turn's liveness; keep it from claiming the ticket is still
    // blocked when the restore just moved it.
    Object.assign(ticket, restored);
  }

  ctx.db.update('runs', runId, { status: 'running', startedAt: nowIso(), lastProgressAt: nowIso(), runtimeId: setting.runtime, model: setting.model ?? null });
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
  // VS-579: whether this turn actually ran contained, and the limit/peak to attribute a kill to.
  let contained = false;
  let memory: { limitMb: number; peakBytes: number | null } | null = null;
  let promptOptions: TurnPromptOptions = { ...(opts.promptOptions ?? {}) };
  // VS-518: set when this turn's runtime reports compacting the session on its own. It keeps the
  // turn's possibly pre-compaction `usage.contextTokens` out of `last_context_tokens` (the adapter
  // already reset the conversation) and tells finalize to release a mark left standing.
  let adapterCompacted = false;

  try {
    // 1. prepare home
    await phase('prepare_home', async () => {
      const r = await ensureHomeCurrent(ctx, deps, agent);
      if (r.briefUpdated) promptOptions.briefUpdated = true;
      if (r.charterChanged) promptOptions.charterChanged = 'the role charter was revised since your last turn';
      if (r.rerendered) promptOptions.homeRerendered = true;
    });

    // 2. prepare worktree (never reset, clean or switch branches)
    // VS-636: a worker that owes a checkout is provisioned here when its worktree is missing — a
    // spawn cut off by a daemon restart leaves a null path — so no turn ever runs checkoutless. A
    // failure is a retryable transient fault, surfaced on the run rather than run without one.
    if (agentNeedsCheckout(agent) || agent.worktreePath) {
      await phase('prepare_worktree', async () => {
        if (agentNeedsCheckout(agent) && !(agent.worktreePath && existsSync(agent.worktreePath))) {
          try {
            const wt = await deps().workers.ensureWorktree(agent.id);
            Object.assign(agent, { worktreePath: wt.path, branch: wt.branch });
          } catch (e) {
            throw Object.assign(
              new Error(`could not provision a worktree for ${agent.name}: ${e instanceof Error ? e.message : String(e)}`),
              { ocFamily: 'transient_upstream' as RunErrorFamily, ocCode: 'worktree_provision_failed' },
            );
          }
        }
        if (agent.worktreePath) {
          const fetched = await git(['fetch', 'origin'], agent.worktreePath, 120_000);
          if (!fetched.ok) record('error', { phase: 'prepare_worktree', message: fetched.stderr.trim().slice(0, 300) }, 'system', 'warn');
        }
      });
    }

    // 3. build the turn prompt
    const policy = sessionPolicyFor(agent, role);
    // VS-542: a changed tool contract retires the session so the runtime fetches the current schema.
    const turnSession = sessions.forTurn({ id: agent.id, kind: agent.kind, runtimeId: setting.runtime }, policy, ctx.toolContractHash?.(agent.kind));
    promptOptions = { ...promptOptions, isFirstTurn: promptOptions.isFirstTurn ?? turnSession.isFirstTurn, sessionStale: turnSession.stale, turnEpoch: run.turnEpoch, runId };
    const prompt = await phase('build_prompt', async () => {
      const text = await buildTurnPrompt(ctx, deps, agent, wakes, promptOptions);
      writeFileSync(join(runDir, 'prompt.md'), text, 'utf8');
      return text;
    });

    // An interactive session's very first turn (VS-101, VS-462) is held to reading its ticket and
    // posting one comment — a ceiling under the role's own permission, never a widening of it: a
    // role that already denies one of these tools still denies it. Computed here because the run
    // token carries it (the MCP server scopes the run's `weave_*` tools off it) and the turn's
    // permission below uses it.
    const isFirstInteractiveTurn = Boolean(ticket?.interactiveSession) && agent.turnCount === 0;

    // 4. run token + MCP config + env
    const token = await mintRunToken(ctx, { agentId: agent.id, runId, ticketId: agent.ticketId, planId: agent.planId, kind: agent.kind, projectId: agent.projectId, roleId: agent.roleId, firstTurn: isFirstInteractiveTurn });
    const baseMcpServers: Record<string, McpServerConfig> = {
      [MCP_SERVER_NAME]: { type: 'http', url: `${ctx.loopbackUrl.replace(/\/$/, '')}/mcp/runs/${runId}`, headers: { Authorization: `Bearer ${token}` } },
    };
    // VS-621: user MCP servers are for the built-in `weave` runtime only, and only they that the
    // run's role (or the weaver's own list) allows. A CLI runtime keeps its own MCP config untouched.
    let mcpServers: Record<string, McpServerConfig> = baseMcpServers;
    let mcpJsonServers: Record<string, McpServerConfig> = baseMcpServers;
    let mcpSecretValues: string[] = [];
    if (setting.runtime === 'weave') {
      const allowed = agent.kind === 'weaver' ? (ctx.config.weaver?.mcpServers ?? []) : (role?.mcpServers ?? []);
      const built = buildMcpServers({ configServers: effectiveMcpServers(ctx), allowed, resolveSecret: (name) => scopedSecretValue(ctx, (n) => deps().secrets.value(n), name) });
      // VS-633: a name the run's role (or the weaver) allows that neither the daemon nor this
      // workspace defines is a configuration error, not something to run without.
      if (built.unknown.length > 0) {
        const who = agent.kind === 'weaver' ? 'the weaver' : `role ${role?.id ?? agent.roleId ?? '(none)'}`;
        throw Object.assign(
          new Error(`${who} allows MCP server${built.unknown.length > 1 ? 's' : ''} ${built.unknown.map((n) => `"${n}"`).join(', ')}, which ${built.unknown.length > 1 ? 'are' : 'is'} defined neither in the daemon settings nor in this workspace; define it or remove it from the allow list`),
          { ocFamily: 'tooling' as RunErrorFamily, ocCode: 'mcp_server_missing' },
        );
      }
      if (built.missing.length > 0) log.warn({ refs: built.missing }, 'MCP servers omitted: a referenced secret has no value');
      mcpServers = { ...baseMcpServers, ...built.servers };
      mcpJsonServers = { ...baseMcpServers, ...built.definitions };
      mcpSecretValues = built.secretValues;
    }
    writeFileSync(join(runDir, 'mcp.json'), JSON.stringify({ mcpServers: redactMcpJson(mcpJsonServers) }, null, 2), 'utf8');

    const secrets = roleSecretsEnv(ctx, deps, role);
    // VS-619: a key the adapter will read from the workspace store is redacted exactly as a
    // role-attached secret is, though it never travels through `env`.
    const storeKey = providerStoreKey(ctx, deps, setting.model);
    redactionSecrets = [token, ...secrets.values, ...(storeKey ? [storeKey] : []), ...mcpSecretValues];
    redact = makeRedactor(redactionSecrets);
    const worktreeIdentity = agent.worktreePath ? (await readGitIdentity(agent.worktreePath)).identity : null;
    const projectIdentity = !worktreeIdentity && project ? (await readGitIdentity(project.clonePath)).identity : null;
    const gitIdentity = worktreeIdentity ?? projectIdentity;
    const env: Record<string, string> = {
      [AC_ENV.API_URL]: ctx.loopbackUrl,
      [AC_ENV.RUN_TOKEN]: token,
      [AC_ENV.RUN_ID]: runId,
      [AC_ENV.AGENT_ID]: agent.id,
      [AC_ENV.AGENT_KIND]: agent.kind,
      [AC_ENV.WORKSPACE_ID]: ctx.workspaceId,
      [AC_ENV.WAKE_REASON]: wakes.map((w) => `${w.source}:${w.reason}`).join('; ').slice(0, 400),
      ...(agent.kind === 'worker' ? testParallelismDefaults(process.env) : {}),
      ...(agent.roleId ? { [AC_ENV.ROLE_ID]: agent.roleId } : {}),
      ...(agent.projectId ? { [AC_ENV.PROJECT_ID]: agent.projectId } : {}),
      ...(agent.ticketId ? { [AC_ENV.TICKET_ID]: agent.ticketId } : {}),
      ...(agent.worktreePath ? { [AC_ENV.WORKTREE]: agent.worktreePath } : {}),
      ...secrets.env,
      ...(gitIdentity ? {
        GIT_AUTHOR_NAME: gitIdentity.name,
        GIT_AUTHOR_EMAIL: gitIdentity.email,
        GIT_COMMITTER_NAME: gitIdentity.name,
        GIT_COMMITTER_EMAIL: gitIdentity.email,
      } : {}),
    };

    const runtime = ctx.registries.runtimes.get(setting.runtime);
    if (!runtime) throw Object.assign(new Error(`runtime ${setting.runtime} is not registered`), { ocFamily: 'tooling' as RunErrorFamily, ocCode: 'runtime_unreachable' });
    // VS-398: a planning agent must never run unless its runtime can actually enforce a tool
    // allowlist — fail closed rather than let it run with every built-in write tool "restricted"
    // would otherwise have denied.
    if (agent.kind === 'planner' && !runtime.capabilities.permissionModes.includes('restricted')) {
      throw Object.assign(
        new Error(`runtime ${setting.runtime} cannot enforce a tool allowlist (no 'restricted' permission mode); refusing to run a planning agent unrestricted`),
        { ocFamily: 'tooling' as RunErrorFamily, ocCode: 'runtime_unreachable' },
      );
    }

    const permission = (role?.permission ?? {}) as { mode?: PermissionMode; allowed?: string[]; denied?: string[]; bashDeny?: string[] };
    // VS-317: a worker's turn denies the runtime's own scheduling tools, whose timer dies with the
    // turn, so it must use `weave_schedule_wakeup` instead. Declared by the adapter; the role's own
    // denials and the weaver's turn are untouched.
    const workerDenied = agent.kind === 'worker' ? (runtime.workerDeniedTools ?? []) : [];
    const deniedTools = workerDenied.length ? [...new Set([...(permission.denied ?? []), ...workerDenied])] : permission.denied;
    const deniedSet = new Set(permission.denied ?? []);
    // VS-398: a planning agent's allowlist applies to every turn, not only the first, and is never
    // widened by a role's own `allowed` (a planner has no role to widen it from in the first place).
    const allowedTools = agent.kind === 'planner'
      ? PLANNER_ALLOWLIST
      : isFirstInteractiveTurn
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

    // VS-579: a worker turn is contained in its own memory-limited scope. The limit is resolved
    // here (role override → workspace default → machine-derived) and the machine is asked once for
    // the base memory; a non-worker agent is never contained.
    const workerMemory = agent.kind === 'worker'
      ? resolveWorkerMemoryMb({
        roleMb: role?.memoryLimitMb ?? null,
        workspaceMb: ctx.config.defaults.workerMemoryMb ?? null,
        baseMemoryMb: baseMemoryMb(),
        maxConcurrentRuns: ctx.config.defaults.maxConcurrentRuns ?? 6,
      })
      : null;
    const containment: ContainmentRequest | undefined = workerMemory ? { runId, memoryMb: workerMemory.mb } : undefined;
    contained = containment !== undefined && systemdScopeAvailable();

    // VS-614: only a turn that owes a report gets the structured-output schema. A ticketless
    // persistent session is a raw session (VS-618, VS-620): no report rules and no shaping of its
    // replies, so it gets neither the schema nor — on a runtime that turns it into a tool — a
    // `submit_result` or a nudge. Every other turn (a worker, the weaver, a planner, or a session
    // that took a ticket) keeps the schema it has always had.
    const owesReport = ticket !== null || agent.kind !== 'session';

    const input: TurnInput = {
      runId,
      turnEpoch: run.turnEpoch,
      cwd: agent.homePath,
      // A curation ticket has no worktree of its own, but by the gate above its evidence — the
      // project's primary clone — is verified current for this turn; grant the runtime the same
      // `--add-dir` filesystem access a real worktree would get, so `work/` in its brief is real.
      worktree: agent.worktreePath
        ? { path: agent.worktreePath, branch: agent.branch ?? '' }
        : (ticket?.originKind === 'curation' && project ? { path: project.clonePath, branch: '' } : null),
      session: { policy: turnSession.policy, ref: turnSession.ref, isFirstTurn: turnSession.isFirstTurn },
      systemPrompt: { text: systemPromptText, mode: turnSession.isFirstTurn ? 'inject' : 'skip' },
      prompt,
      ...(owesReport ? { outputSchema: RUN_REPORT_JSON_SCHEMA as unknown as Record<string, unknown> } : {}),
      mcpServers,
      env,
      // The runtime's own options (compaction, tool-output limit, extra args, …) ride with the
      // setting that names the runtime; `liveInput` is the engine's and always wins.
      options: { ...(setting.options ?? {}), liveInput: ctx.config.defaults.liveInput },
      limits: { timeoutMs: turnTimeoutMs },
      permission: {
        // VS-171: Claude auto-mode can classify away weave_*; skip-permissions is only on for bypass.
        mode: agent.kind === 'weaver' ? 'bypass' : agent.kind === 'planner' ? 'restricted' : (permission.mode ?? ctx.config.defaults.permissionMode ?? 'auto'),
        allowedTools,
        deniedTools,
        // VS-608: the built-in agent's `auto` mode appends the role's own bash deny patterns.
        ...(permission.bashDeny?.length ? { bashDeny: permission.bashDeny } : {}),
        // VS-462: a runtime with its own tool switch (opencode) disables everything outside this
        // list on the opening turn; a runtime with none still cannot reach past it via MCP.
        ...(isFirstInteractiveTurn ? { firstTurn: true } : {}),
      },
      model: setting.model ?? null,
      effort: setting.effort ?? null,
      configHome,
      workspaceId: ctx.workspaceId,
      containment,
    };

    // 5. spawn + stream
    result = await phase('turn', async () => {
      // VS-285: the daemon never provokes a refresh of its own — that would rotate a token that
      // rotates-on-use out from under every other holder, including the owner's own CLI. The turn
      // simply spawns; the runtime's own CLI refreshes on its own terms if it needs to, and reports
      // its own authentication failure (classified `family: 'auth'` by runtime-sdk's process output
      // parser) if that genuinely fails, which routes through the existing login-outage gate below.
      return runtime.runTurn(
        input,
        {
          onSpawn: (info) => {
            ctx.db.update('runs', runId, { pid: info.pid, pgid: info.pgid ?? null });
            const entry = state.active.get(runId);
            if (entry) entry.pid = info.pid;
            record('turn.started', { pid: info.pid }, 'system');
          },
          onEvent: (ev: RuntimeEvent) => {
            record(ev.type, ev.payload ?? {});
            // VS-518: the runtime decided to compact the conversation itself (no auto-compaction
            // policy in play). Give it the same session state and notification the daemon's
            // out-of-band path writes, so the composer banner appears and clears and the dispatch
            // gate is consistent — and consume the context observation so the automatic policy can
            // never fire on the pre-compaction number the runtime has already replaced.
            if (ev.type === 'session.compaction.started') {
              adapterCompacted = true;
              const at = nowIso();
              sessions.setCompacting(turnSession.session.id, at);
              ctx.events.broadcast('session.compaction', 'agent', agent.id, { agentId: agent.id, compacting: true, at, origin: 'adapter' });
              log.info({ agentId: agent.id, origin: 'adapter' }, 'runtime compaction started');
            } else if (ev.type === 'session.compaction.completed') {
              adapterCompacted = true;
              const postTokens = typeof ev.payload['postTokens'] === 'number' ? ev.payload['postTokens'] : null;
              sessions.noteCompactionEnd(turnSession.session.id, postTokens);
              ctx.events.broadcast('session.compaction', 'agent', agent.id, { agentId: agent.id, compacting: false, ok: true, error: null, origin: 'adapter' });
              log.info({ agentId: agent.id, origin: 'adapter', postTokens }, 'runtime compaction completed');
            }
          },
          onPartial: (p) => partials.push(p),
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
    // VS-579: read the scope's peak before the transient unit is reset, so a SIGKILL can be told
    // apart from a memory kill with evidence rather than an assumption.
    if (workerMemory) {
      const peakBytes = contained ? await readScopeMemoryPeak(scopeUnitName(runId)) : null;
      memory = { limitMb: workerMemory.mb, peakBytes };
      // The turn is over and its peak read: drop the transient scope so a failed unit does not linger.
      if (contained) releaseScope(scopeUnitName(runId));
    }
  } catch (e) {
    const err = e as Error & { ocFamily?: RunErrorFamily; ocCode?: string };
    failure = { code: err.ocCode ?? 'engine_error', family: err.ocFamily ?? 'tooling', message: truncate(err.message, 4000) };
    log.error({ err: err.message }, 'run failed in the engine');
    record('error', { message: failure.message, code: failure.code }, 'system', 'error');
  }

  // The turn is over (finished, failed or cancelled): nothing partial outlives it.
  partials.clear();
  state.partials.delete(runId);

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
  const finished = finalize(ctx, deps, sessions, {
    run, agent, role, project, ticket, wakes, result, failure, report,
    durationMs: Date.now() - started,
    sessionId: sessions.active(agent.id)?.id ?? null,
    cancelled: state.active.get(runId)?.cancelled ?? null,
    compactedInTurn: adapterCompacted,
    memory,
    record,
  });
  await afterTurnHooks(ctx, deps, agent, ticket);
  await deliverSessionAnswer(ctx, deps, { agent, ticket, wakes, result, run: finished });
  return finished;
}

/** VS-598: how many recent thread messages are read when resolving a resumed turn's session thread. */
const SESSION_PENDING_MESSAGES = 50;

/**
 * VS-596: the conversation thread and the human message(s) a session turn answers. Normally they come
 * from the `human_message` wake; when a turn was retried, the retry wake carries them forward so a
 * retried-and-succeeded turn still knows where to deliver (and what to quote).
 *
 * VS-598: a resume whose wake carries no thread context — the watchdog's retry after a silence or a
 * hard timeout — falls back to the session's own thread, but only for a retry, and only while that
 * thread still holds an unanswered human message; an unrelated self-scheduled turn therefore never
 * answers a stale message.
 */
function sessionReplyContext(
  wakes: Wakeup[],
  fallback?: { agentId: string; deps: () => CoreServices; ctx?: WorkspaceContext },
): { threadId: string | null; messageIds: string[] } {
  const flat = flattenWakes(wakes);
  const isString = (v: unknown): v is string => typeof v === 'string';
  const human = flat.filter((w) => w.source === 'human_message');
  const threadId = human.map((w) => w.payload['threadId']).find(isString)
    ?? flat.map((w) => w.payload['threadId']).find(isString)
    ?? null;
  const messageIds = human.length > 0
    ? human.map((w) => w.payload['messageId']).filter(isString)
    : ((flat.map((w) => w.payload['messageIds']).find(Array.isArray) as unknown[] | undefined)?.filter(isString) ?? []);
  if (threadId || !fallback) return { threadId, messageIds };
  if (!flat.some((w) => w.source === 'retry')) return { threadId: null, messageIds: [] };
  // VS-620: a retry wake names the run it resumes, and that run's own `human_message` wakes are
  // exactly the messages it answers. Resolving them directly stops a message a completed tool-only
  // turn already handled (which posted nothing, so the thread still looks unanswered) from being
  // re-quoted by a later resume.
  const retried = retriedHumanMessages(flat, fallback);
  if (retried) return retried;
  const own = fallback.deps().threads.list({ agentId: fallback.agentId })[0];
  if (!own) return { threadId: null, messageIds: [] };
  const pending = pendingHumanMessages(fallback.deps().threads.messages(own.id, { limit: SESSION_PENDING_MESSAGES }));
  if (pending.length === 0) return { threadId: null, messageIds: [] };
  return { threadId: own.id, messageIds: pending.map((m) => m.id) };
}

/**
 * VS-620: the human messages a retry wake resumes — the `human_message` wakes of the run named by the
 * retry payload's `retryOfRunId`. Null when the retry names no run, that run is gone, or it was not
 * woken by a human; the caller then falls back to the thread's still-waiting message (the resume may
 * be for a self-scheduled run that a human message arrived during).
 */
function retriedHumanMessages(
  flat: Array<{ source: string; payload: Record<string, unknown> }>,
  fallback: { ctx?: WorkspaceContext },
): { threadId: string; messageIds: string[] } | null {
  const ctx = fallback.ctx;
  if (!ctx) return null;
  const isString = (v: unknown): v is string => typeof v === 'string';
  const retryOfRunId = flat.map((w) => w.payload['retryOfRunId']).find(isString);
  if (!retryOfRunId) return null;
  const run = ctx.db.get<Run>('SELECT * FROM runs WHERE id = ?', [retryOfRunId]);
  if (!run || !Array.isArray(run.wakeupIds)) return null;
  const wakes = run.wakeupIds
    .map((id) => ctx.db.get<{ source: string; payload: Record<string, unknown> | null }>('SELECT * FROM wakeups WHERE id = ?', [id]))
    .filter((w): w is { source: string; payload: Record<string, unknown> | null } => Boolean(w));
  const human = wakes.filter((w) => w.source === 'human_message');
  if (human.length === 0) return null;
  const threadId = human.map((w) => (w.payload ?? {})['threadId']).find(isString);
  const messageIds = human.map((w) => (w.payload ?? {})['messageId']).filter(isString);
  if (!threadId || messageIds.length === 0) return null;
  return { threadId, messageIds };
}

/**
 * VS-598: the human messages a thread still owes a real answer — every inbound message after the last
 * `agent`-authored outbound message, oldest-first. A `system` notice (the stopped attempt's own
 * "interrupted" notice) is deliberately not an answer: the watchdog cuts a turn, that run posts its
 * notice, and the retry-woken resume must still see the human's message and deliver the answer.
 */
function pendingHumanMessages(
  msgs: Array<{ id: string; direction: string; authorKind: string }>,
): Array<{ id: string; direction: string; authorKind: string }> {
  let lastAnswer = -1;
  for (let i = 0; i < msgs.length; i += 1) {
    const m = msgs[i]!;
    if (m.direction === 'outbound' && m.authorKind === 'agent') lastAnswer = i;
  }
  return msgs.slice(lastAnswer + 1).filter((m) => m.direction === 'inbound');
}

/**
 * VS-596: a ticketless persistent session has no reply tool, so the engine delivers the turn's final
 * text to the conversation thread that woke it. Reads the normalized `TurnResult`, so it behaves the
 * same on every runtime; runs after finalize and never fails the finished run. A turn that already
 * wrote an outbound message to the thread (a reply tool) is left alone. A missing or whitespace-only
 * answer posts nothing (VS-618: a turn that only ran tools is a complete turn, not a notice), and a
 * turn that ends without an answer — failed, timed out, cancelled or interrupted — leaves a
 * plain-reason system notice, unless the daemon
 * is going to retry or resume it, in which case it stays unannounced until the final outcome. VS-598:
 * when the wake carries no thread (the watchdog's retry), the session's own thread supplies both the
 * target and the unanswered human message, so a resumed turn still delivers.
 */
async function deliverSessionAnswer(
  ctx: WorkspaceContext,
  deps: () => CoreServices,
  input: { agent: Agent; ticket: Ticket | null; wakes: Wakeup[]; result: TurnResult | null; run: Run },
): Promise<void> {
  const log = ctx.log('run').child({ runId: input.run.id });
  if (input.agent.kind !== 'session' || input.ticket) return;
  const { threadId, messageIds: replyToMessageIds } = sessionReplyContext(input.wakes, { agentId: input.agent.id, deps, ctx });
  if (!threadId) return;
  try {
    // The wake names the thread; never post into one another agent owns (a stale or forged payload).
    const thread = deps().threads.get(threadId);
    if (thread.agentId !== input.agent.id) return;
    // A reply tool that carried this run id already answered; do not post a second time.
    if (deps().threads.hasOutboundForRun(threadId, input.run.id)) return;
    // Re-read the run: finalize schedules a retry (and parks a failure) after it returns, so the
    // snapshot it handed back does not yet know whether this outcome is terminal.
    const run = ctx.db.get<Run>('SELECT * FROM runs WHERE id = ?', [input.run.id]) ?? input.run;
    if (run.status === 'succeeded') {
      const raw = input.result?.finalText;
      const text = typeof raw === 'string' ? raw.trim() : '';
      // A runtime that returned the structured run report as its final text must not leak JSON.
      const answer = text.length > 0 && extractReport(text) === null ? text : null;
      // VS-618: a turn that produced no final text (it only ran tools, or ended after a tool result)
      // is a normal, complete turn — post nothing, not a notice. The report guard stays so a runtime
      // cannot leak report JSON into the conversation.
      if (answer === null) return;
      await deps().threads.outbound(
        { kind: 'agent', id: input.agent.id, runId: input.run.id },
        threadId,
        answer,
        { runId: input.run.id, defaultReplyToMessageIds: replyToMessageIds },
      );
      return;
    }
    const errorText = ctx.db.get<{ errorText: string | null }>('SELECT error_text FROM agents WHERE id = ?', [input.agent.id])?.errorText ?? null;
    const retryScheduled = !!ctx.db.get<{ scheduledRetryAt: string | null }>('SELECT scheduled_retry_at FROM runs WHERE id = ?', [input.run.id])?.scheduledRetryAt;
    // VS-598: a runtime auth outage preserves this turn's wake so it resumes once the runtime is
    // healthy, while an exhausted outage parks the work and raises a card. The notice says which, so
    // the human knows whether to wait or to log in and act.
    const resumesPending = input.wakes.some((w) => ctx.db.get<{ status: string }>('SELECT status FROM wakeups WHERE id = ?', [w.id])?.status === 'queued');
    const notice = sessionOutcomeNotice(run, errorText, retryScheduled, resumesPending);
    if (notice === null) return;
    await deps().threads.outbound({ kind: 'system', id: null }, threadId, notice, { runId: input.run.id });
  } catch (e) {
    log.warn({ err: String(e), agentId: input.agent.id }, 'failed to deliver a session answer to its thread');
  }
}

/**
 * VS-596: the plain reason a human-woken session turn ended without an answer, or null when the daemon
 * will retry or resume the turn by itself — announcing it then would only add noise before the real
 * outcome. The wording is for the human: no run ids and no error internals.
 */
function sessionOutcomeNotice(run: Run, errorText: string | null, retryScheduled: boolean, resumesPending: boolean): string | null {
  if (retryScheduled) return null; // a retry is already scheduled
  // A daemon shutdown, or a live human message, resumes the turn: the next run carries the outcome.
  if (run.errorCode === 'interrupted_by_shutdown' || run.errorCode === 'interrupted_by_message') return null;
  // VS-598: a runtime authentication outage is resumed on the same wake once the runtime is healthy
  // again; an exhausted one parks the work and raises a card. Say which, so the human knows the next step.
  if (run.status === 'failed' && run.errorFamily === 'auth') {
    return resumesPending
      ? 'The turn failed: the runtime needs you to log in again. This conversation resumes once the login is renewed.'
      : 'The turn failed: the runtime needs you to log in again. Log in, then retry this conversation.';
  }
  switch (run.status) {
    case 'timed_out': return 'This turn took too long and was stopped before it could answer.';
    case 'cancelled': return 'This turn was cancelled before it answered.';
    case 'interrupted': return 'This turn was interrupted before it answered.';
    case 'failed':
      // VS-598: a usage limit is not retried, so the notice carries the reset (when the runtime named
      // one) and the human's next step rather than just the family.
      return run.errorFamily === 'provider_quota'
        ? quotaNotice(errorText)
        : `The turn failed: ${plainFailureReason(run, errorText)}.`;
    default: return null;
  }
}

/** VS-598: the human-facing usage-limit notice — the reset when the runtime reported one, and the fact that nothing retries it. */
function quotaNotice(errorText: string | null): string {
  const reset = parseResetTime(errorText ?? '');
  const resetText = reset ? ` It resets at ${fmtUtc(reset)} UTC.` : '';
  return `The turn failed: the usage limit was reached.${resetText} Nothing retries automatically — send another message to try again.`;
}

/** The human-readable half of a failed turn's notice, falling back to the family when there is no usable message. */
function plainFailureReason(run: Run, errorText: string | null): string {
  if (run.errorCode === 'model_unconfigured') return 'no model is configured for this session';
  if (run.errorCode === WORKER_MEMORY_ERROR_CODE) return 'it ran out of memory';
  const first = (errorText ?? '').split('\n')[0]!.replace(/\s+/g, ' ').trim();
  if (first && first !== run.errorCode) return truncate(first, 240);
  if (run.errorFamily === 'transient_upstream') return 'the model provider kept failing';
  return run.errorCode ?? 'an unexpected error';
}

/**
 * The daemon's end-of-worker-turn side effects, in order and each isolated, so neither can fail the
 * finished run. First republish a plan revised while the ticket stayed `proposed` (VS-364 — answering
 * weaver concerns or steering moves no ticket, so no transition published the new artifacts), then
 * tell the weaver when a held merge card's delivery head has moved since its review (VS-365). Only
 * worker turns with a ticket.
 */
async function afterTurnHooks(ctx: WorkspaceContext, deps: () => CoreServices, agent: Agent, ticket: Ticket | null): Promise<void> {
  if (agent.kind !== 'worker' || !ticket) return;
  try {
    await deps().tickets.republishRevisedPlan({ kind: 'system', id: null }, ticket.id);
  } catch (e) {
    ctx.log('run').warn({ err: String(e), ticketId: ticket.id }, 'republish of a revised plan failed');
  }
  try {
    await deps().tickets.noteHeldReviewHead({ kind: 'system', id: null }, ticket.id);
  } catch (e) {
    ctx.log('run').warn({ err: String(e), ticketId: ticket.id }, 'held-review head check failed');
  }
}

export interface FinalizeInput {
  run: Run; agent: Agent; role: Role | null; project: Project | null; ticket: Ticket | null; wakes: Wakeup[];
  result: TurnResult | null; failure: { code: string; family: RunErrorFamily; message: string } | null; report: RunReport | null;
  durationMs: number; sessionId: string | null; cancelled: { mode: 'interrupt' | 'kill'; cause?: 'message' } | null;
  /** VS-518: this turn's runtime reported compacting the session, so its context observation is not trustworthy. */
  compactedInTurn?: boolean;
  /** VS-579: the worker memory limit in force and the contained scope's peak, when contained. */
  memory?: { limitMb: number; peakBytes: number | null } | null;
  record: (type: RunEvent['type'], payload: Record<string, unknown>, stream?: 'stdout' | 'stderr' | 'runtime' | 'system', level?: string) => void;
}

function finalize(ctx: WorkspaceContext, deps: () => CoreServices, sessions: SessionsService, f: FinalizeInput): Run {
  const log = ctx.log('run').child({ runId: f.run.id });
  const now = nowIso();
  const runId = f.run.id;
  const r = f.result;
  // VS-339: whether the daemon began shutting down or draining while this turn ran, captured once so
  // the classification below cannot depend on a later state change. Set synchronously before any
  // child process can be signalled, so a runtime that exits on that signal is caught here.
  const shuttingDown = runState(ctx).shuttingDown;

  const memoryKilled = isMemoryKill(f, shuttingDown);

  let status: Run['status'] = 'succeeded';
  let errorCode: string | null = null;
  let errorFamily: RunErrorFamily | null = null;
  if (f.failure) { status = 'failed'; errorCode = f.failure.code; errorFamily = f.failure.family; }
  else if (r?.timedOut) { status = 'timed_out'; errorCode = 'timeout'; errorFamily = 'tooling'; }
  else if (memoryKilled) {
    // VS-579: the worker's own scope was killed with its peak at the limit — a memory kill, not the
    // ambiguous interrupt a bare SIGKILL used to be labelled.
    status = 'failed';
    errorCode = WORKER_MEMORY_ERROR_CODE;
    errorFamily = 'resource';
  }
  else if (r?.error) { status = 'failed'; errorCode = r.error.code; errorFamily = r.error.family; }
  else if (r && r.exitCode !== 0 && r.exitCode !== null) { status = 'failed'; errorCode = `exit_${r.exitCode}`; errorFamily = 'unknown'; }
  if (shuttingDown && (f.cancelled !== null || status !== 'succeeded')) {
    // VS-339: a turn still active when the daemon began shutting down or draining was cut off by that
    // shutdown, whatever its exit code or the error its runtime attached — claude's exit 143 and
    // opencode's exit 1 both arrive as `unknown` failures, and the runtime-error branch above would
    // otherwise win. A turn the shutdown cancelled is caught even if its child happened to exit 0; a
    // turn that genuinely completed before the shutdown keeps its success. It is not the agent's
    // failure, and its wake is re-queued below so the next daemon resumes the session.
    status = 'interrupted';
    errorCode = 'interrupted_by_shutdown';
    errorFamily = 'tooling';
  } else if (f.cancelled?.mode === 'interrupt' || (!f.failure && !r?.error && (r?.signal === 'SIGTERM' || r?.signal === 'SIGKILL' || r?.exitCode === 143 || r?.exitCode === 137))) {
    // A human interrupt (via /runs/:id/cancel) or a human's live message on a runtime that cannot
    // take mid-turn input (VS-254): not the agent's failure. (A daemon shutdown is handled above by
    // the explicit mark, not by guessing from the child's exit.)
    status = 'interrupted';
    errorCode = f.cancelled?.cause === 'message' ? 'interrupted_by_message' : 'interrupted';
    errorFamily = 'tooling';
  } else if (f.cancelled) { status = 'cancelled'; errorCode = errorCode ?? 'cancelled'; errorFamily = errorFamily ?? 'tooling'; }

  // VS-339: a shutdown cut is resumed by leaving its wakes queued and its worker active, as boot
  // recovery does for a run orphaned by a hard kill.
  const shutdownInterrupted = status === 'interrupted' && errorCode === 'interrupted_by_shutdown';

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
  const memoryMessage = memoryKilled && f.memory
    ? `worker exceeded its memory limit (peak ${fmtMemoryMb(f.memory.peakBytes)} of ${f.memory.limitMb} MB)`
    : null;
  const failureMessage = memoryMessage ?? f.failure?.message ?? r?.error?.message ?? null;
  const summary = f.report?.summary ?? memoryMessage ?? (r?.finalText ? r.finalText.slice(0, 1000) : f.failure?.message ?? null);

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
        // VS-518: when the runtime compacted the session itself, the turn's reported context size
        // may predate the compaction. Keep what the compaction boundary recorded (the post size, or
        // null) rather than re-arming the automatic policy with a stale number.
        contextTokens: f.compactedInTurn ? undefined : (usage?.contextTokens ?? null),
      });
      // A `started` with no `completed` (the turn was cut mid-compaction) still releases the mark,
      // so the dispatcher is not held on a dead flag; a completion already cleared it.
      if (f.compactedInTurn) sessions.setCompacting(f.sessionId, null, null);
    }

    // Terminal cleanup marks a worker done before the run finalizes. Re-read both rows because the
    // ticket/agent snapshots in FinalizeInput were taken before the runtime turn. Preserving that
    // state prevents a successful self-closing run (or an externally closed ticket whose run is
    // being interrupted) from resurrecting the worker into the live set.
    const currentTicket = f.ticket ? ctx.db.get<{ status: string }>('SELECT status FROM tickets WHERE id = ?', [f.ticket.id]) : null;
    const currentAgent = ctx.db.get<{ status: string }>('SELECT status FROM agents WHERE id = ?', [f.agent.id]);
    const terminalWorkerReleased = f.agent.kind === 'worker'
      && currentTicket != null
      && TERMINAL_TICKET_STATUSES.includes(currentTicket.status as (typeof TERMINAL_TICKET_STATUSES)[number])
      && currentAgent?.status === 'done';
    const agentStatus = terminalWorkerReleased
      ? 'done'
      : status === 'succeeded' || shutdownInterrupted ? 'active' : (errorFamily && RETRYABLE.includes(errorFamily)) || status === 'cancelled' ? 'active' : 'error';
    ctx.db.update('agents', f.agent.id, {
      status: agentStatus,
      turnEpoch: f.run.turnEpoch,
      turnCount: f.agent.turnCount + 1,
      lastRunAt: now,
      errorText: status === 'succeeded' ? null : (failureMessage ?? errorCode),
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
    // VS-339: a shutdown cut is preserved the same way — its wakes stay queued so the next daemon
    // resumes the turn with no human card.
    const preserveWake = (errorFamily === 'auth' && !authFailuresExhausted) || shutdownInterrupted;
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
  // VS-328: the run is over — drop the activity line (keep the last test tally) and push the result.
  try { deps().activity.finish(f.agent.id); } catch { /* activity service unavailable */ }
  try { deps().routines.onRunFinalized(f.wakes); } catch { /* routines service unavailable */ }

  // VS-579: a memory kill is legible on the ticket (every time) and filed as an incident when it
  // repeats on the same ticket. Neither touches the retry below — the ladder still runs.
  if (memoryKilled) recordMemoryKill(ctx, deps, f, runId, memoryMessage);

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
    parkForHuman(ctx, deps, f, errorFamily, errorCode, failureMessage);
  } else if (errorFamily === 'auth') {
    gateRuntimeForLogin(ctx, deps, { runtimeId: f.run.runtimeId, agentId: f.agent.id, agentName: f.agent.name, runId, ticketId: f.agent.ticketId }, failureMessage);
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
        // VS-596: a retry wake is a fresh wake with no human message of its own, so carry the thread
        // and waking message(s) forward — otherwise a session's retried turn could not deliver its answer.
        const reply = sessionReplyContext(f.wakes, f.agent.kind === 'session' ? { agentId: f.agent.id, deps, ctx } : undefined);
        deps().wake.enqueue(f.agent.id, {
          source: 'retry', reason: `retry after ${errorCode ?? errorFamily}`,
          payload: { retryOfRunId: runId, attempt: attempt + 1, ...(reply.threadId ? { threadId: reply.threadId, messageIds: reply.messageIds } : {}) }, notBefore,
          idempotencyKey: `retry:${runId}:${attempt + 1}`, requestedBy: { kind: 'system', id: null },
        });
      } catch (e) { log.warn({ err: String(e) }, 'failed to schedule retry wake'); }
    } else {
      log.warn({ runId, errorFamily }, 'retry budget exhausted');
      parkForHuman(ctx, deps, f, errorFamily, errorCode, failureMessage);
    }
  } else if (status === 'failed' && f.agent.kind === 'worker' && errorFamily !== 'model_refusal') {
    parkForHuman(ctx, deps, f, errorFamily, errorCode, failureMessage);
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

  // Three consecutive turns with no observable progress is a gate finding for the conductor (PLAN
  // §9.4). A run counts against the worker only when its own report said nothing actionable
  // happened (`empty` or a validly-idle turn), it left no evidence of progress on the ticket, and the
  // ticket was in a status where the worker was actually expected to act — not one where it is
  // correctly waiting on someone else (`proposed`, `in_review`, `blocked`) (VS-145).
  if ((liveness === 'empty' || liveness === 'idle') && f.agent.kind === 'worker' && f.agent.ticketId) {
    const ticketId = f.agent.ticketId;
    const countsAgainst = (run: { id: string; liveness: string; finishedAt: string | null }): boolean => {
      if (run.liveness !== 'empty' && run.liveness !== 'idle') return false;
      const statusThen = ticketStatusAsOf(ctx, ticketId, run.finishedAt ?? now);
      if (statusThen !== null && TICKET_STATUSES_NOT_EXPECTING_ACTION.has(statusThen)) return false;
      return !runProducedEvidence(ctx, run.id, ticketId);
    };
    const recent = ctx.db.all<{ id: string; liveness: string; finishedAt: string | null }>(
      "SELECT id, liveness, finished_at FROM runs WHERE agent_id = ? AND status = 'succeeded' ORDER BY created_at DESC, rowid DESC LIMIT 3",
      [f.agent.id],
    );
    if (recent.length === 3 && recent.every(countsAgainst)) {
      try {
        deps().decisions.create({ kind: 'system', id: null }, {
          ticketId: f.agent.ticketId, kind: 'gate_finding', owner: 'weaver',
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

/** `n MB`, or `unknown` when the scope's peak could not be read. */
function fmtMemoryMb(bytes: number | null): string {
  if (bytes === null || !Number.isFinite(bytes)) return 'unknown';
  return `${Math.round(bytes / (1024 * 1024))} MB`;
}

/**
 * VS-579: an unattributed SIGKILL whose contained scope peaked at (or near) the limit is a memory
 * kill. A human cancel, a daemon shutdown and a watchdog cut are excluded before this is consulted —
 * the caller checks them first — so a deliberate kill is never relabelled as memory.
 */
export function isMemoryKill(f: FinalizeInput, shuttingDown: { reason: string; at: string } | null): boolean {
  if (shuttingDown || f.cancelled) return false;
  if (!f.memory || !f.result) return false;
  const r = f.result;
  if (r.signal !== 'SIGKILL' && r.exitCode !== 137) return false;
  const peak = f.memory.peakBytes;
  if (peak === null) return false;
  return peak >= f.memory.limitMb * 1024 * 1024 * MEMORY_KILL_PEAK_RATIO;
}

/**
 * VS-579: the human-facing trace of a memory kill — an activity entry on every kill, and one system
 * incident once the same ticket has been memory-killed more than once with no incident open. Filing
 * never suppresses the retry ladder (the caller runs it after this).
 */
export function recordMemoryKill(ctx: WorkspaceContext, deps: () => CoreServices, f: FinalizeInput, runId: string, message: string | null): void {
  const log = ctx.log('run').child({ runId });
  const peakBytes = f.memory?.peakBytes ?? null;
  const limitMb = f.memory?.limitMb ?? null;
  try {
    recordActivity(ctx.db, ctx.workspaceId, { kind: 'system', id: null }, 'worker.memory_limit', 'agent', f.agent.id,
      { runId, limitMb, peakBytes, peakMb: peakBytes === null ? null : Math.round(peakBytes / (1024 * 1024)) },
      f.agent.ticketId ?? null, f.agent.projectId ?? null);
  } catch (e) { log.warn({ err: String(e) }, 'memory-kill activity could not be recorded'); }

  const ticketId = f.agent.ticketId ?? null;
  if (!ticketId) return;
  try {
    const prior = ctx.db.get<{ n: number }>(
      'SELECT COUNT(*) n FROM runs WHERE agent_id = ? AND id != ? AND error_code = ?',
      [f.agent.id, runId, WORKER_MEMORY_ERROR_CODE],
    )?.n ?? 0;
    if (prior < 1) return;
    const incidents = deps().incidents;
    if (!incidents) return;
    const open = incidents.list({ status: 'open', limit: 200 }).items;
    if (open.some((i) => i.ticketId === ticketId && i.title.startsWith('Worker memory'))) return;
    incidents.create({
      reporterKind: 'system',
      title: `Worker memory limit repeated${f.ticket ? ` on ${f.ticket.identifier}` : ''}`,
      whatFailed: message ?? 'a worker was killed for exceeding its memory limit',
      tryingToDo: "run a worker turn without one worker's memory use threatening the daemon or its peers",
      evidence: [
        `run: ${runId}`,
        `limit: ${limitMb ?? 'unknown'} MB`,
        `peak: ${fmtMemoryMb(peakBytes)}`,
        f.agent.roleId ? `role: ${f.agent.roleId}` : null,
      ].filter(Boolean).join('\n'),
      workspaceId: ctx.workspaceId,
      projectId: f.agent.projectId ?? null,
      ticketId,
      agentId: f.agent.id,
      runId,
      roleId: f.agent.roleId ?? null,
    });
  } catch (e) { log.warn({ err: String(e) }, 'memory-kill incident could not be filed'); }
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
export function parkForHuman(ctx: WorkspaceContext, deps: () => CoreServices, f: { run: Pick<Run, 'id' | 'runtimeId'>; agent: Agent }, family: RunErrorFamily | null, code: string | null, message: string | null): void {
  const log = ctx.log('run').child({ runId: f.run.id });
  const ticketId = f.agent.ticketId;
  const quota = family === 'provider_quota';
  const resetAt = quota ? parseResetTime(message ?? '') : null;
  // Bounded once and reused everywhere below, so the pause detail and the decision's context always
  // agree on the same text rather than two call sites each picking their own cap (VS-201).
  const boundedMessage = message ? truncate(message, 4000) : null;
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
        message: boundedMessage,
        resetAt: resetAt ? resetAt.toISOString() : null, runId: f.run.id,
      },
      updatedAt: nowIso(),
    });
  });

  let identifier: { identifier: string; status: string; workerModelId: string | null } | undefined;
  step('read the ticket', () => {
    identifier = ticketId
      ? ctx.db.get<{ identifier: string; status: string; workerModelId: string | null }>(
        'SELECT identifier, status, worker_model_id FROM tickets WHERE id = ?', [ticketId],
      )
      : undefined;
  });

  let raised = false;
  step('raise the decision', () => {
    // No per-runtime options (VS-77): answering one used to write this agent's own runtime, which is
    // the override the two settings replaced. Where the runtime is the problem, the way out is the
    // workspace setting, so the card names it instead of offering to change it for one worker.
    const runtime = f.run.runtimeId;
    const setting = f.agent.kind === 'weaver' ? 'models.conductor' : 'models.workers';
    deps().decisions.create({ kind: 'system', id: null }, {
      kind: 'retry_approval', owner: 'human', ticketId: ticketId ?? null,
      title: quota
        ? `${f.agent.name} hit the ${runtime} usage limit${identifier ? ` on ${identifier.identifier}` : ''}`
        : `${f.agent.name} failed${identifier ? ` on ${identifier.identifier}` : ''}: ${code ?? family ?? 'unknown error'}`,
      context: [
        `Failure: ${family ?? 'unknown'}${code ? ` (${code})` : ''}`,
        boundedMessage ? `Last error: ${boundedMessage}` : null,
        quota
          ? `${resetAt ? `The runtime says the limit resets at ${fmtUtc(resetAt)} UTC. ` : ''}A usage limit is not retried automatically, so nothing will run until you answer: retry now, ${resetAt ? 'retry when it resets' : 'retry in an hour'}, or cancel.`
          : 'Automatic retries are spent. Retry or cancel the ticket.',
        `This ran on ${runtime}. The runtime is the workspace's ${setting} setting — change it there and retry, and every ${f.agent.kind === 'weaver' ? 'weaver turn' : 'worker'} follows.`,
        'Retrying resumes the same session on the same branch.',
      ].filter(Boolean).join('\n\n'),
      options: [
        { key: 'retry', label: 'Retry now', recommended: !quota },
        resetAt
          ? { key: 'retry_at_reset', label: `Retry when the limit resets (${fmtUtc(resetAt)} UTC)`, recommended: true }
          : { key: 'retry_1h', label: 'Retry in an hour', recommended: quota },
        ...quotaSwitchOptions(ctx, quota, identifier?.workerModelId ?? null),
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

function quotaSwitchOptions(
  ctx: WorkspaceContext,
  quota: boolean,
  currentId: string | null,
): Array<{ key: string; label: string; description?: string }> {
  if (!quota) return [];
  const opts = effectiveModels(ctx.daemon, ctx.config).workerOptions ?? [];
  return opts
    .filter((o) => o.id !== currentId && isWorkerOptionConfigured(o))
    .map((o) => ({
      key: `switch:${o.id}`,
      label: `Continue on ${o.id}`,
      ...(o.description ? { description: o.description } : {}),
    }));
}

const FOURTEEN_DAYS_MS = 14 * 24 * 60 * 60 * 1000;
const WINDOW_SLACK_MS = 2 * 60 * 1000;
const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

function namedWindowMs(message: string): number | null {
  const m = message.toLowerCase();
  const forN = /for\s+(\d+)\s*(hours?|hrs?|minutes?|mins?)\b/.exec(m);
  const dash = /(\d+)\s*-\s*(hours?|hrs?)\b/.exec(m);
  const hit = forN ?? dash;
  if (!hit) return null;
  const n = Number(hit[1]);
  const unit = hit[2]!;
  return unit.startsWith('h') ? n * 3_600_000 : n * 60_000;
}

function inBound(t: Date, now: Date, boundMs: number): boolean {
  const ms = t.getTime();
  return ms > now.getTime() && ms <= now.getTime() + boundMs;
}

function parseIsoWithOffset(message: string): Date | null {
  const r = /(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2}))/.exec(message);
  if (!r) return null;
  const t = new Date(r[1]!.replace(' ', 'T'));
  return Number.isNaN(t.getTime()) ? null : t;
}

function parseNaiveClock(message: string): { y: number; mo: number; d: number; h: number; min: number; sec: number } | null {
  const r = /(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?(?!(?:\.\d+)?(?:Z|[+-]\d{2}))/.exec(message);
  if (!r) return null;
  return { y: Number(r[1]), mo: Number(r[2]), d: Number(r[3]), h: Number(r[4]), min: Number(r[5]), sec: Number(r[6] ?? 0) };
}

function earliestNaiveOffset(
  clock: { y: number; mo: number; d: number; h: number; min: number; sec: number },
  now: Date,
  boundMs: number,
): Date | null {
  const asUtc = Date.UTC(clock.y, clock.mo - 1, clock.d, clock.h, clock.min, clock.sec);
  let best: Date | null = null;
  for (let off = -12; off <= 14; off += 1) {
    const t = new Date(asUtc - off * 3_600_000);
    if (!inBound(t, now, boundMs)) continue;
    if (!best || t.getTime() < best.getTime()) best = t;
  }
  return best;
}

function parseClaudeOuDate(message: string, now: Date): Date | null {
  const r = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\s+(\d{1,2}),(?:\s+(\d{4}),)?\s+(\d{1,2}):(\d{2})\s*(am|pm)\b/i.exec(message);
  if (!r) return null;
  const mo = MONTHS[r[1]!.toLowerCase()];
  if (mo === undefined) return null;
  let h = Number(r[4]);
  if (r[6]!.toLowerCase() === 'pm' && h < 12) h += 12;
  if (r[6]!.toLowerCase() === 'am' && h === 12) h = 0;
  const year = r[3] ? Number(r[3]) : now.getUTCFullYear();
  const t = new Date(Date.UTC(year, mo, Number(r[2]), h, Number(r[5]), 0));
  if (t.getTime() > now.getTime() || r[3]) return t;
  return new Date(Date.UTC(year + 1, mo, Number(r[2]), h, Number(r[5]), 0));
}

/**
 * Provider reset timestamps from captured stderr (VS-238). `now` is the failure instant
 * (`parseResetTime` runs inside `parkForHuman`), not the start of the named window.
 */
export function parseResetTime(message: string, now = new Date()): Date | null {
  const windowMs = namedWindowMs(message);
  const boundMs = windowMs != null ? windowMs + WINDOW_SLACK_MS : FOURTEEN_DAYS_MS;

  const iso = parseIsoWithOffset(message);
  if (iso) return inBound(iso, now, boundMs) ? iso : null;

  const naive = parseNaiveClock(message);
  if (naive) return earliestNaiveOffset(naive, now, boundMs);

  const ou = parseClaudeOuDate(message, now);
  if (ou) return inBound(ou, now, boundMs) ? ou : null;

  const m = message.toLowerCase();
  let r = /(?:reset|resets|try again|available)\s+in\s+(\d+)\s*(hour|hr|minute|min|second|sec)/.exec(m);
  if (r) {
    const n = Number(r[1]); const unit = r[2]!;
    const ms = unit.startsWith('h') ? n * 3_600_000 : unit.startsWith('m') ? n * 60_000 : n * 1000;
    return new Date(now.getTime() + ms);
  }
  // Require am/pm or `:mm` so `resets at 2026-…` cannot take hour 20 from the year.
  r = /resets?\s+(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/.exec(m)
    ?? /resets?\s+(?:at\s+)?(\d{1,2}):(\d{2})(?!\d)/.exec(m);
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
