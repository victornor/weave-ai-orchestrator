/**
 * Usage analytics (PLAN §16.2/§16.3). Every answer is derived from `usage_events`:
 * a scope (workspace | project | role | worker | ticket subtree | model | runtime)
 * x a window (resolved by shared/usage.ts) x a grain (hour|day|week).
 *
 * Buckets are computed in JS with `bucketKey` so the CLI, TUI and web all agree with
 * the shared helper. Series points only contain buckets that actually have rows —
 * empty buckets are omitted, callers that draw axes fill the gaps from `range`.
 */
import type * as S from '@agent-conductor/shared';
import { OcError, bucketKey, estimateCostCents, resolveUsageWindow } from '@agent-conductor/shared';
import { newId, nowIso } from '@agent-conductor/db';
import type { UsageQuery, UsageSeriesPoint, UsageService } from '../api.js';
import type { WorkspaceContext } from '../context.js';
import { recordActivity } from '../events.js';

type Param = string | number | null;

interface ScopeClause { sql: string; params: Param[] }

interface RawRow {
  occurredAt: string; runId: string; agentId: string; model: string | null;
  inputTokens: number; cachedInputTokens: number; outputTokens: number;
  durationMs: number; costCents: number | null; costStatus: S.CostStatus;
}

interface AggRow {
  tokensIn: number; tokensOut: number; tokensCached: number; runs: number;
  durationMs: number; costCents: number; costReportedCents: number;
}

const SUBTREE_SQL =
  'WITH RECURSIVE sub(id) AS (SELECT id FROM tickets WHERE id = ? UNION SELECT t.id FROM tickets t JOIN sub ON t.parent_id = sub.id) SELECT id FROM sub';

const RAW_COLUMNS =
  'u.occurred_at, u.run_id, u.agent_id, u.model, u.input_tokens, u.cached_input_tokens, u.output_tokens, u.duration_ms, u.cost_cents, u.cost_status';

const AGG_COLUMNS = [
  "COALESCE(SUM(u.input_tokens), 0) AS tokensIn",
  "COALESCE(SUM(u.output_tokens), 0) AS tokensOut",
  "COALESCE(SUM(u.cached_input_tokens), 0) AS tokensCached",
  "COUNT(DISTINCT u.run_id) AS runs",
  "COALESCE(SUM(u.duration_ms), 0) AS durationMs",
  "COALESCE(SUM(u.cost_cents), 0) AS costCents",
  "COALESCE(SUM(CASE WHEN u.cost_status = 'reported' THEN u.cost_cents ELSE 0 END), 0) AS costReportedCents",
].join(', ');

/** Prefix for the synthetic `top by ticket` key of usage that belongs to an agent rather than a ticket. */
const AGENT_KEY_PREFIX = 'agent:';

/**
 * Grouping key per `top` dimension. Ticket-less usage is not unattributable: it is an agent's own
 * turns (today only the conductor's chat), so it groups per agent under `agent:<id>` and gets a real
 * label instead of collapsing into one "unknown" bucket.
 */
const TOP_KEY: Record<'model' | 'ticket' | 'role' | 'worker' | 'project', string> = {
  model: "COALESCE(u.model, 'unknown')",
  ticket: `COALESCE(u.ticket_id, '${AGENT_KEY_PREFIX}' || u.agent_id)`,
  role: "COALESCE(u.role_id, 'unknown')",
  worker: "COALESCE(u.agent_id, 'unknown')",
  project: "COALESCE(u.project_id, 'unknown')",
};

export function emptyPoint(bucket: string): UsageSeriesPoint {
  return { bucket, tokensIn: 0, tokensOut: 0, tokensCached: 0, runs: 0, durationMs: 0, costCents: 0, costReportedCents: 0 };
}

function point(bucket: string, a: AggRow): UsageSeriesPoint {
  return {
    bucket,
    tokensIn: Number(a.tokensIn), tokensOut: Number(a.tokensOut), tokensCached: Number(a.tokensCached),
    runs: Number(a.runs), durationMs: Number(a.durationMs),
    costCents: Number(a.costCents), costReportedCents: Number(a.costReportedCents),
  };
}

/** Accumulator: costs sum with nulls treated as 0, runs are distinct run ids. */
interface Acc { p: UsageSeriesPoint; runs: Set<string> }
function newAcc(bucket: string): Acc { return { p: emptyPoint(bucket), runs: new Set() }; }
function add(acc: Acc, r: RawRow): void {
  acc.p.tokensIn += r.inputTokens;
  acc.p.tokensOut += r.outputTokens;
  acc.p.tokensCached += r.cachedInputTokens;
  acc.p.durationMs += r.durationMs;
  const cost = r.costCents ?? 0;
  acc.p.costCents += cost;
  if (r.costStatus === 'reported') acc.p.costReportedCents += cost;
  if (r.runId) acc.runs.add(r.runId);
}
function seal(acc: Acc): UsageSeriesPoint { acc.p.runs = acc.runs.size; return acc.p; }

function rowPoint(r: RawRow): UsageSeriesPoint {
  const acc = newAcc(r.occurredAt);
  add(acc, r);
  return seal(acc);
}

export function createUsageService(ctx: WorkspaceContext): UsageService {
  const log = ctx.log('usage');

  const resolveTicketId = (idOrIdentifier: string): string => {
    const row = ctx.db.get<{ id: string }>(
      'SELECT id FROM tickets WHERE workspace_id = ? AND (id = ? OR identifier = ?)',
      [ctx.workspaceId, idOrIdentifier, idOrIdentifier],
    );
    if (!row) throw new OcError('not_found', `ticket ${idOrIdentifier} not found`, { ticket: idOrIdentifier });
    return row.id;
  };

  /** `workspace`, `project:<id>`, `role:<id>`, `worker:<id>`, `ticket:<id|IDENT>` (subtree), `model:<id>`, `runtime:<id>`. */
  const parseScope = (scope: string): ScopeClause => {
    const raw = (scope ?? '').trim();
    if (raw === '' || raw === 'workspace') return { sql: '', params: [] };
    const sep = raw.indexOf(':');
    const kind = sep < 0 ? raw : raw.slice(0, sep);
    const value = sep < 0 ? '' : raw.slice(sep + 1).trim();
    if (sep < 0 || value === '') throw new OcError('validation', `usage scope "${raw}" must be "<kind>:<id>"`, { scope: raw });
    switch (kind) {
      case 'project': return { sql: ' AND u.project_id = ?', params: [value] };
      case 'role': return { sql: ' AND u.role_id = ?', params: [value] };
      case 'worker': return { sql: ' AND u.agent_id = ?', params: [value] };
      case 'model': return { sql: ' AND u.model = ?', params: [value] };
      case 'runtime': return { sql: ' AND u.runtime_id = ?', params: [value] };
      case 'ticket': return { sql: ` AND u.ticket_id IN (${SUBTREE_SQL})`, params: [resolveTicketId(value)] };
      default: throw new OcError('validation', `unknown usage scope "${kind}"`, { scope: raw });
    }
  };

  const range = (q: UsageQuery): S.UsageRange => {
    if (q.window === 'custom' && !(q.start && q.end)) throw new OcError('validation', 'custom window requires start and end', { window: q.window });
    return resolveUsageWindow(q.window, q.grain, new Date(), q.start && q.end ? { start: q.start, end: q.end } : undefined);
  };

  const rawRows = (start: string, end: string, scope: ScopeClause): RawRow[] =>
    ctx.db.all<RawRow>(
      `SELECT ${RAW_COLUMNS} FROM usage_events u WHERE u.workspace_id = ? AND u.occurred_at >= ? AND u.occurred_at < ?${scope.sql} ORDER BY u.occurred_at`,
      [ctx.workspaceId, start, end, ...scope.params],
    );

  const aggregate = (rows: RawRow[], bucket: string): UsageSeriesPoint => {
    const acc = newAcc(bucket);
    for (const r of rows) add(acc, r);
    return seal(acc);
  };

  /** The conductor's own turns read as its chat; any other ticket-less agent is named and marked as such. */
  const agentLabel = (agentId: string): string => {
    const a = ctx.db.get<{ name: string; kind: S.AgentKind }>('SELECT name, kind FROM agents WHERE id = ? AND workspace_id = ?', [agentId, ctx.workspaceId]);
    if (!a) return 'unknown';
    return a.kind === 'conductor' ? `${a.name} chat` : `${a.name} · no ticket`;
  };

  const label = (by: 'model' | 'ticket' | 'role' | 'worker' | 'project', key: string): string => {
    if (key === 'unknown') return 'unknown';
    switch (by) {
      case 'model': return key;
      case 'ticket': {
        if (key.startsWith(AGENT_KEY_PREFIX)) return agentLabel(key.slice(AGENT_KEY_PREFIX.length));
        const t = ctx.db.get<{ identifier: string; title: string }>('SELECT identifier, title FROM tickets WHERE id = ? AND workspace_id = ?', [key, ctx.workspaceId]);
        return t ? `${t.identifier} ${t.title}` : key;
      }
      case 'role': return ctx.db.get<{ name: string }>('SELECT name FROM roles WHERE id = ? AND workspace_id = ?', [key, ctx.workspaceId])?.name ?? key;
      case 'worker': return ctx.db.get<{ name: string }>('SELECT name FROM agents WHERE id = ? AND workspace_id = ?', [key, ctx.workspaceId])?.name ?? key;
      case 'project': return ctx.db.get<{ name: string }>('SELECT name FROM projects WHERE id = ? AND workspace_id = ?', [key, ctx.workspaceId])?.name ?? key;
    }
  };

  return {
    series(q) {
      const r = range(q);
      const scope = parseScope(q.scope);
      const rows = rawRows(r.start, r.end, scope);
      const buckets = new Map<string, Acc>();
      for (const row of rows) {
        const key = bucketKey(row.occurredAt, r.grain);
        let acc = buckets.get(key);
        if (!acc) { acc = newAcc(key); buckets.set(key, acc); }
        add(acc, row);
      }
      const points = [...buckets.keys()].sort().map((k) => seal(buckets.get(k)!));
      const total = aggregate(rows, r.start);
      const previous = aggregate(rawRows(r.prevStart, r.prevEnd, scope), r.prevStart);
      const costReportedShare = total.costCents === 0 ? 0 : total.costReportedCents / total.costCents;
      log.debug({ scope: q.scope, window: q.window, grain: r.grain, points: points.length, rows: rows.length }, 'usage series');
      return { range: r, points, total, previous, costReportedShare };
    },

    top(q) {
      const r = range(q);
      const scope = parseScope(q.scope);
      const keyExpr = TOP_KEY[q.by];
      if (!keyExpr) throw new OcError('validation', `unknown usage grouping "${q.by}"`, { by: q.by });
      const rows = ctx.db.all<AggRow & { key: string }>(
        `SELECT ${keyExpr} AS key, ${AGG_COLUMNS} FROM usage_events u
         WHERE u.workspace_id = ? AND u.occurred_at >= ? AND u.occurred_at < ?${scope.sql}
         GROUP BY ${keyExpr} ORDER BY costCents DESC, tokensIn + tokensOut DESC LIMIT 20`,
        [ctx.workspaceId, r.start, r.end, ...scope.params],
      );
      return rows.map((row) => ({ ...point(r.start, row), key: row.key, label: label(q.by, row.key) }));
    },

    ticket(ticketId) {
      const id = resolveTicketId(ticketId);
      const own = ctx.db.all<RawRow>(
        `SELECT ${RAW_COLUMNS} FROM usage_events u WHERE u.workspace_id = ? AND u.ticket_id = ? ORDER BY u.occurred_at`,
        [ctx.workspaceId, id],
      );
      const subtreeRows = ctx.db.all<RawRow>(
        `SELECT ${RAW_COLUMNS} FROM usage_events u WHERE u.workspace_id = ? AND u.ticket_id IN (${SUBTREE_SQL}) ORDER BY u.occurred_at`,
        [ctx.workspaceId, id],
      );
      const first = own[0]?.occurredAt ?? nowIso();
      // Turns are the ticket's own usage rows (one per recorded turn), matching `total`.
      const turns = own.map((row) => ({ ...rowPoint(row), runId: row.runId, agentId: row.agentId, model: row.model, occurredAt: row.occurredAt }));
      return { total: aggregate(own, first), subtree: aggregate(subtreeRows, subtreeRows[0]?.occurredAt ?? first), turns };
    },

    models(q) {
      const r = range(q);
      const scope = parseScope(q.scope);
      const rows = ctx.db.all<AggRow & { model: string; provider: string | null }>(
        `SELECT COALESCE(u.model, 'unknown') AS model, u.provider AS provider, ${AGG_COLUMNS} FROM usage_events u
         WHERE u.workspace_id = ? AND u.occurred_at >= ? AND u.occurred_at < ?${scope.sql}
         GROUP BY u.model, u.provider ORDER BY costCents DESC, tokensIn + tokensOut DESC`,
        [ctx.workspaceId, r.start, r.end, ...scope.params],
      );
      return rows.map((row) => ({ model: row.model, provider: row.provider ?? null, ...point(r.start, row) }));
    },
  };
}

export interface RecordUsageInput {
  agentId: string;
  runId: string;
  runtimeId: string;
  projectId?: string | null;
  roleId?: string | null;
  ticketId?: string | null;
  provider?: string | null;
  model?: string | null;
  billingType?: S.BillingType;
  inputTokens: number;
  cachedInputTokens?: number;
  outputTokens: number;
  /** Runtime-reported cost in cents; when absent the pricing table estimates it (PLAN §16.2). */
  costCents?: number | null;
  durationMs?: number;
  occurredAt?: string;
}

/**
 * Insert one `usage_events` row. Called by the run engine once per run (or per usage delta).
 * Cost precedence: runtime-reported → `reported`; pricing table → `estimated`; unknown model → `unpriced`.
 */
export function recordUsage(ctx: WorkspaceContext, row: RecordUsageInput): S.UsageEvent {
  const inputTokens = row.inputTokens ?? 0;
  const outputTokens = row.outputTokens ?? 0;
  const cachedInputTokens = row.cachedInputTokens ?? 0;
  let costCents: number | null = row.costCents ?? null;
  let costStatus: S.CostStatus;
  if (costCents !== null) costStatus = 'reported';
  else {
    costCents = estimateCostCents(row.model, { inputTokens, outputTokens, cachedInputTokens }, ctx.config.pricingOverrides);
    costStatus = costCents === null ? 'unpriced' : 'estimated';
  }
  const event: S.UsageEvent = {
    id: newId(),
    workspaceId: ctx.workspaceId,
    projectId: row.projectId ?? null,
    roleId: row.roleId ?? null,
    agentId: row.agentId,
    ticketId: row.ticketId ?? null,
    runId: row.runId,
    runtimeId: row.runtimeId,
    provider: row.provider ?? null,
    model: row.model ?? null,
    billingType: row.billingType ?? 'unknown',
    inputTokens,
    cachedInputTokens,
    outputTokens,
    costCents,
    costStatus,
    durationMs: row.durationMs ?? 0,
    occurredAt: row.occurredAt ?? nowIso(),
  };
  ctx.db.insert('usage_events', event as unknown as Record<string, unknown>);
  recordActivity(
    ctx.db, ctx.workspaceId, { kind: 'agent', id: row.agentId, runId: row.runId }, 'usage.recorded', 'usage', event.id,
    { model: event.model, costCents: event.costCents, costStatus: event.costStatus, tokensIn: inputTokens, tokensOut: outputTokens },
    event.ticketId,
  );
  ctx.events.emit('usage.recorded', 'usage', event.id, event);
  ctx.log('usage').debug({ runId: event.runId, model: event.model, costStatus: event.costStatus }, 'usage recorded');
  return event;
}
