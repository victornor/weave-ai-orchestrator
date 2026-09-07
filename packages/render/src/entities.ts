/** Ticket and worker view models (design contract §4 "Ticket card" / "Worker card"). */
import type { Agent, CostStatus, Ticket } from '@agent-conductor/shared';
import { agentUiStatus, ticketUiStatus, waitingOnRuntimeLogin } from '@agent-conductor/shared';
import { formatAge, formatCost, formatTokens, initials, joinMeta, oneLine } from './format.js';
import { redact } from './redact.js';
import { statusGlyph, statusLabel } from './status.js';
import type { TicketSummary, WorkerCardModel, WorktreeView } from './types.js';

export interface UsageBadge { tokens?: number | null; costCents?: number | null; costStatus?: CostStatus | null }

export interface TicketSummaryContext {
  projectName?: string | null;
  workerName?: string | null;
  usage?: UsageBadge | null;
  hasOpenHumanDecision?: boolean;
  workerStalled?: boolean;
  now?: Date;
}

export function ticketToSummary(ticket: Ticket, ctx: TicketSummaryContext = {}): TicketSummary {
  const t = ticket ?? ({} as Ticket);
  const uiStatus = ticketUiStatus(t.status, {
    hasOpenHumanDecision: ctx.hasOpenHumanDecision === true,
    workerStalled: ctx.workerStalled === true,
  });
  const tokens = ctx.usage?.tokens ?? null;
  const tokensLabel = tokens === null ? null : `${formatTokens(tokens)} tok`;
  const costLabel = ctx.usage?.costCents === undefined ? null : formatCost(ctx.usage?.costCents ?? null, ctx.usage?.costStatus ?? null);
  const identifier = t.identifier ?? t.id ?? '';
  const title = oneLine(redact(t.title ?? ''), 120);
  const meta = joinMeta(identifier, tokensLabel, costLabel === '—' ? null : costLabel);

  return {
    id: t.id ?? '',
    identifier,
    title,
    kind: t.kind,
    status: t.status,
    uiStatus,
    glyph: statusGlyph(uiStatus),
    priority: t.priority,
    project: ctx.projectName ?? t.projectId ?? null,
    worker: ctx.workerName ?? null,
    autoMerge: t.autoMerge === true,
    age: formatAge(t.createdAt, ctx.now ?? new Date()),
    tokens: tokensLabel,
    cost: costLabel === '—' ? null : costLabel,
    meta,
    line: joinMeta(`${statusGlyph(uiStatus)} ${identifier}`, title, (t.kind ?? '').toUpperCase() || null, ctx.workerName ?? null, formatAge(t.createdAt, ctx.now ?? new Date())),
  };
}

export interface WorkerCardContext {
  roleName?: string | null;
  projectName?: string | null;
  ticket?: { id: string; identifier: string; title: string } | null;
  /** Last status line the worker reported ("running vitest — 38/41 passed"). */
  lastLine?: string | null;
  worktree?: { status?: string | null; dirty?: boolean | null; ahead?: number | null; behind?: number | null } | null;
  usage?: UsageBadge | null;
  needsYou?: boolean;
  stalled?: boolean;
  now?: Date;
}

/**
 * One line saying why a paused worker stopped: the failure family, the runtime's own message and the
 * reset time when it reported one. Falls back to the free-text `pauseReason` — that is all a worker
 * a human paused carries, and all a worker paused before VS-56 has. Null unless it is paused.
 */
export function workerPauseReason(agent: Agent): string | null {
  if (agent?.status !== 'paused') return null;
  const d = agent.pauseDetail;
  // A worker waiting on its runtime's login is not broken and has nothing for the human to answer:
  // say what it is waiting for, not which failure family it landed in (VS-75).
  if (waitingOnRuntimeLogin(agent)) return `waiting on the ${agent.runtimeId} login · resumes on its own`;
  if (!d) return agent.pauseReason ?? null;
  const parts = [d.family, d.message ? oneLine(redact(d.message), 160) : null, d.resetAt ? `resets ${d.resetAt.slice(0, 16).replace('T', ' ')} UTC` : null].filter(Boolean);
  return parts.length ? parts.join(' · ') : agent.pauseReason ?? null;
}

export function workerToCard(agent: Agent, ctx: WorkerCardContext = {}): WorkerCardModel {
  const a = agent ?? ({} as Agent);
  const uiStatus = agentUiStatus(a.status, { needsYou: ctx.needsYou === true, stalled: ctx.stalled === true });
  const worktree = worktreeView(ctx.worktree ?? null, a);
  const tokens = ctx.usage?.tokens ?? null;
  const tokensLabel = tokens === null ? null : `${formatTokens(tokens)} tok`;
  const cost = ctx.usage?.costCents === undefined ? null : formatCost(ctx.usage?.costCents ?? null, ctx.usage?.costStatus ?? null);
  const name = a.name ?? (a.kind === 'conductor' ? 'Conductor' : 'Worker');
  // Without a joined ticket we still know its id, which is better than an empty column.
  const ticket = ctx.ticket ?? (a.ticketId ? { id: a.ticketId, identifier: a.ticketId, title: '' } : null);

  return {
    id: a.id ?? '',
    name,
    initials: initials(name),
    kind: a.kind === 'conductor' ? 'conductor' : 'worker',
    role: ctx.roleName ?? a.roleId ?? null,
    project: ctx.projectName ?? a.projectId ?? null,
    ticket,
    status: a.status,
    uiStatus,
    glyph: statusGlyph(uiStatus),
    statusLabel: statusLabel(uiStatus),
    lastLine: ctx.lastLine ? oneLine(redact(ctx.lastLine), 120) : null,
    pauseReason: workerPauseReason(a),
    worktree,
    runtime: a.runtimeId ?? 'unknown',
    model: a.model ?? null,
    turn: a.turnCount ?? 0,
    tokens: tokensLabel,
    cost: cost === '—' ? null : cost,
    meta: joinMeta(ctx.projectName ?? a.projectId, ticket?.identifier, a.runtimeId, a.model, tokensLabel, cost === '—' ? null : cost, workerPauseReason(a)),
    windowTitle: joinMeta(name, ticket?.identifier, statusLabel(uiStatus)),
  };
}

/** `● dirty ↑3 ↓0` */
function worktreeView(wt: WorkerCardContext['worktree'], agent: Agent): WorktreeView | null {
  if (!wt && !agent?.worktreePath) return null;
  const status = wt?.status ?? 'active';
  const dirty = wt?.dirty === true || status === 'dirty';
  const ahead = wt?.ahead ?? 0;
  const behind = wt?.behind ?? 0;
  return {
    status,
    dirty,
    ahead,
    behind,
    label: `${dirty ? '●' : '○'} ${status}${ahead || behind ? ` ↑${ahead} ↓${behind}` : ''}`,
  };
}
