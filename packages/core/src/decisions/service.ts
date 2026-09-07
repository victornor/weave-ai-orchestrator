import { decisionRow, newId, nowIso, type Db } from '@agent-conductor/db';
import { OcError, type Decision, type DecisionKind, type DecisionOwner, type DecisionStatus } from '@agent-conductor/shared';
import type { Actor, CoreServices, DecisionCreateInput, DecisionsService } from '../api.js';
import type { WorkspaceContext } from '../context.js';
import { recordActivity } from '../events.js';
import { tx } from '../tickets/tx.js';
import { WORKERS_RUNTIME_CORRELATION } from '../models/index.js';

const asDecision = (r: Record<string, unknown>): Decision => decisionRow(r) as unknown as Decision;

export function createDecisionsService(ctx: WorkspaceContext, deps: () => CoreServices): DecisionsService {
  const db: Db = ctx.db;
  const log = ctx.log('decision');
  const ws = ctx.workspaceId;

  function find(id: string): Decision | null {
    const r = db.get<Record<string, unknown>>('SELECT * FROM decisions WHERE workspace_id = ? AND id = ?', [ws, id]);
    return r ? asDecision(r) : null;
  }
  function get(id: string): Decision {
    const d = find(id);
    if (!d) throw new OcError('not_found', `decision ${id} not found`);
    return d;
  }
  function conductorId(): string | null {
    return db.get<{ id: string }>("SELECT id FROM agents WHERE workspace_id = ? AND kind = 'conductor'", [ws])?.id ?? null;
  }
  function wake(agentId: string | null | undefined, source: Parameters<CoreServices['wake']['enqueue']>[1]['source'], reason: string, payload: Record<string, unknown> = {}): void {
    if (!agentId) return;
    try {
      deps().wake.enqueue(agentId, { source, reason, payload });
    } catch (e) {
      log.warn({ err: e, agentId, source }, 'wake enqueue failed');
    }
  }

  /** Default owner per kind (PLAN §15), overridable per project for plan approvals only. */
  function defaultOwner(kind: DecisionKind, ticketId: string | null | undefined): DecisionOwner {
    switch (kind) {
      case 'gate_finding':
        return 'conductor';
      case 'merge_approval':
        return 'human';
      case 'hire_approval':
        return ctx.config.defaults.hireApproval === 'conductor' ? 'conductor' : 'human';
      case 'plan_approval': {
        const p = ticketId
          ? db.get<{ policies: { proposalApproval?: DecisionOwner | 'none' } | null }>(
              'SELECT p.policies_json FROM tickets t JOIN projects p ON p.id = t.project_id WHERE t.id = ?', [ticketId])
          : null;
        const owner = p?.policies?.proposalApproval ?? ctx.config.defaults.proposalApproval;
        return owner === 'conductor' ? 'conductor' : 'human';
      }
      default:
        return 'human';
    }
  }

  function supersedeOpen(actor: Actor, ticketId: string | null, correlationKey: string): number {
    const rows = db.all<{ id: string }>(
      'SELECT id FROM decisions WHERE workspace_id = ? AND ticket_id IS ? AND correlation_key = ? AND status = ?',
      [ws, ticketId, correlationKey, 'open'],
    );
    for (const r of rows) {
      db.update('decisions', r.id, { status: 'superseded' as DecisionStatus });
      recordActivity(db, ws, actor, 'decision.superseded', 'decision', r.id, { correlationKey }, ticketId);
      ctx.events.emit('decision.superseded', 'decision', r.id, get(r.id));
    }
    return rows.length;
  }

  function create(actor: Actor, input: DecisionCreateInput): Decision {
    const ticketId = input.ticketId ?? null;
    if (ticketId && !db.get('SELECT id FROM tickets WHERE id = ?', [ticketId])) throw new OcError('not_found', `ticket ${ticketId} not found`);
    const correlationKey = input.correlationKey ?? `${input.kind}:${ticketId ?? 'workspace'}`;
    const owner = input.owner ?? defaultOwner(input.kind, ticketId);
    const id = newId();
    const now = nowIso();
    return tx(db, () => {
      supersedeOpen(actor, ticketId, correlationKey);
      db.insert('decisions', {
        id, workspaceId: ws, ticketId, kind: input.kind, owner, askedByAgentId: input.askedByAgentId ?? null,
        askedInRunId: input.askedInRunId ?? actor.runId ?? null, title: input.title, context: input.context ?? '',
        optionsJson: input.options ?? [], allowFreeText: input.allowFreeText ?? true, recommendation: input.recommendation ?? null,
        status: 'open', expiresAt: input.expiresInHours ? new Date(Date.now() + input.expiresInHours * 3600e3).toISOString() : null,
        targetJson: input.target ?? null, correlationKey, createdAt: now,
      });
      const d = get(id);
      recordActivity(db, ws, actor, 'decision.create', 'decision', id, { kind: input.kind, owner, correlationKey }, ticketId);
      ctx.events.emit('decision.created', 'decision', id, d);
      if (owner === 'conductor') wake(conductorId(), 'system', `decision ${input.kind} awaits you`, { decisionId: id, ticketId });
      return d;
    });
  }

  // ---------- answering ----------

  function ticketOf(d: Decision): string | null {
    return d.ticketId ?? null;
  }

  async function applyPlanApproval(actor: Actor, d: Decision, key: string, text: string | null): Promise<void> {
    const ticketId = ticketOf(d);
    if (!ticketId) return;
    const tickets = deps().tickets;
    if (key === 'approve') {
      await tickets.transition(actor, ticketId, { to: 'approved', note: text ? `Plan approved: ${text}` : 'Plan approved.' });
    } else if (key === 'revise') {
      if (text) tickets.comment(actor, ticketId, `Plan revision requested: ${text}`, 'comment', 'trusted');
      await tickets.transition(actor, ticketId, { to: 'proposing', note: 'Revision requested; rework the plan.' });
    } else if (key === 'reject') {
      tickets.cancel(actor, ticketId, text ? `Plan rejected: ${text}` : 'Plan rejected.');
    }
  }

  async function applyMergeApproval(actor: Actor, d: Decision, key: string, text: string | null): Promise<void> {
    const ticketId = ticketOf(d);
    if (!ticketId) return;
    const tickets = deps().tickets;
    if (key === 'approve') {
      await tickets.transition(actor, ticketId, { to: 'merging', note: text ? `Merge approved: ${text}` : 'Merge approved.' });
    } else {
      if (text) tickets.comment(actor, ticketId, `Changes requested before merge: ${text}`, 'comment', 'trusted');
      const t = tickets.get(ticketId);
      if (t.status === 'in_review') await tickets.transition(actor, ticketId, { to: 'in_progress', note: 'Changes requested by the reviewer.' });
    }
  }

  async function applyHireApproval(actor: Actor, d: Decision, key: string): Promise<void> {
    const roleId = (d.target as { roleId?: string } | null)?.roleId;
    if (!roleId) {
      log.warn({ decisionId: d.id }, 'hire_approval without target.roleId; nothing to activate');
      return;
    }
    if (key === 'reject' || key === 'decline') return;
    await deps().roles.activate(actor, roleId);
    // The new role's first job: the project's unassigned "describe" scout ticket, if any, starts now
    // rather than waiting for the conductor's next turn.
    try {
      const role = deps().roles.get(roleId);
      const waiting = db.all<{ id: string; identifier: string }>(
        "SELECT id, identifier FROM tickets WHERE workspace_id = ? AND project_id = ? AND status IN ('backlog','todo') AND assignee_role_id IS NULL AND worker_id IS NULL AND origin_kind = 'project_describe'",
        [ws, role.projectId],
      );
      for (const t of waiting) {
        deps().tickets.assign(actor, t.id, roleId);
        const now = deps().tickets.get(t.id);
        if (now.status === 'backlog') await deps().tickets.transition(actor, t.id, { to: 'todo', note: `${role.name} hired; starting the project description.` });
      }
    } catch (e) {
      log.warn({ err: e, roleId }, 'assigning the scout ticket after the hire failed');
    }
  }

  /** The structured pause the run engine recorded, for a card raised before `target` carried the reset time. */
  function pauseDetailOf(agentId: string): { resetAt?: string | null } | null {
    return db.get<{ pauseDetail: { resetAt?: string | null } | null }>('SELECT pause_detail_json FROM agents WHERE id = ?', [agentId])?.pauseDetail ?? null;
  }

  async function applyRetryApproval(actor: Actor, d: Decision, key: string): Promise<void> {
    const target = (d.target ?? {}) as { agentId?: string; ticketId?: string | null; resetAt?: string | null };
    if (!target.agentId) return;
    if (key === 'cancel') {
      if (target.ticketId) deps().tickets.cancel(actor, target.ticketId, 'cancelled from the retry decision');
      else await deps().workers.cancel(actor, target.agentId, 'cancelled from the retry decision');
      return;
    }
    // Both deferred answers wake the worker later rather than now; nothing was booked when the card
    // was raised, so this is the only thing that ever schedules an attempt after a usage limit.
    if (key === 'retry_1h' || key === 'retry_at_reset') {
      const atReset = key === 'retry_at_reset';
      const stored = atReset ? (target.resetAt ?? pauseDetailOf(target.agentId)?.resetAt ?? null) : null;
      const parsed = stored ? Date.parse(stored) : NaN;
      const at = new Date(Number.isFinite(parsed) ? parsed : Date.now() + 3_600_000);
      db.update('agents', target.agentId, { status: 'active', pauseReason: null, pauseDetailJson: null, updatedAt: nowIso() });
      deps().wake.enqueue(target.agentId, {
        source: 'retry',
        reason: atReset ? 'the human asked for a retry when the usage limit resets' : 'the human asked for a retry in an hour',
        payload: { decisionId: d.id },
        notBefore: at.toISOString(), idempotencyKey: `${key}:${d.id}`, requestedBy: actor,
      });
      return;
    }
    await deps().workers.relaunch(actor, target.agentId, 'the human asked for a retry');
    if (target.ticketId) {
      const t = deps().tickets.get(target.ticketId);
      if (t.status === 'blocked') await deps().tickets.transition(actor, t.id, { to: t.executionRunId ? 'in_progress' : 'todo', note: 'retrying' }).catch(() => undefined);
    }
  }

  /**
   * The one `question` the daemon asks itself: which runtime a mixed-runtime workspace's workers
   * should use after the VS-77 migration. Any other question is a human's or an agent's, and its
   * answer is the answer — nothing here to apply.
   */
  async function applyWorkersRuntimeQuestion(actor: Actor, d: Decision, key: string): Promise<void> {
    if (d.correlationKey !== WORKERS_RUNTIME_CORRELATION || !key.startsWith('runtime:')) return;
    await deps().models.settleWorkersRuntime(actor, key.slice('runtime:'.length));
  }

  function applyDiscardApproval(actor: Actor, d: Decision, key: string, text: string | null): void {
    const ticketId = ticketOf(d);
    if (!ticketId) return;
    const approved = key === 'approve';
    deps().tickets.comment(
      actor,
      ticketId,
      approved ? `Discard approved${text ? `: ${text}` : '.'} Unlanded work on this ticket may be removed.` : `Discard declined${text ? `: ${text}` : '.'}`,
      'status',
      'trusted',
    );
    recordActivity(db, ws, actor, approved ? 'ticket.discard_approved' : 'ticket.discard_declined', 'ticket', ticketId, { decisionId: d.id }, ticketId);
    wake(conductorId(), 'decision_answered', `discard ${approved ? 'approved' : 'declined'}`, { decisionId: d.id, ticketId, answer: key });
  }

  async function answer(actor: Actor, id: string, ans: { key?: string; text?: string; remember?: boolean }): Promise<Decision> {
    const d = get(id);
    if (d.status !== 'open') throw new OcError('wrong_status', `decision ${id} is ${d.status}`);
    if (!ans.key && !ans.text) throw new OcError('validation', 'an answer needs a key or free text');
    // No `runtime:` escape hatch (VS-77): a card cannot move one agent onto another runtime, so an
    // answer that is not one of the offered options is a validation error again.
    if (ans.key && d.options.length && !d.options.some((o) => o.key === ans.key)) {
      throw new OcError('validation', `unknown option "${ans.key}"`, { options: d.options.map((o) => o.key) });
    }
    if (!ans.key && !d.allowFreeText) throw new OcError('validation', 'this decision requires one of its options');

    const key = ans.key ?? null;
    const text = ans.text ?? null;
    const answered = tx(db, () => {
      db.update('decisions', d.id, {
        status: 'answered' as DecisionStatus, answerKey: key, answerText: text,
        answeredByKind: actor.kind, answeredById: actor.id, answeredAt: nowIso(),
      });
      const next = get(d.id);
      recordActivity(db, ws, actor, 'decision.answer', 'decision', d.id, { key, kind: d.kind }, d.ticketId);
      ctx.events.emit('decision.answered', 'decision', d.id, next);
      return next;
    });

    // Verbatim answer text is already recorded; side effects come second so a failure never loses the answer.
    const effective = key ?? '';
    try {
      switch (d.kind) {
        case 'plan_approval': await applyPlanApproval(actor, answered, effective, text); break;
        case 'merge_approval': await applyMergeApproval(actor, answered, effective, text); break;
        case 'hire_approval': await applyHireApproval(actor, answered, effective); break;
        case 'retry_approval': await applyRetryApproval(actor, answered, effective); break;
        case 'discard_approval': applyDiscardApproval(actor, answered, effective, text); break;
        case 'question': await applyWorkersRuntimeQuestion(actor, answered, effective); break;
        default: break;
      }
    } catch (e) {
      log.error({ err: e, decisionId: d.id, kind: d.kind }, 'decision side effect failed');
      throw e;
    }

    if (answered.askedByAgentId) {
      wake(answered.askedByAgentId, 'decision_answered', `decision answered: ${answered.title}`, {
        decisionId: answered.id, answer: { key, text }, ticketId: answered.ticketId,
      });
    }
    if (ans.remember) {
      try {
        deps().knowledge.appendDecision(answered);
      } catch (e) {
        log.warn({ err: e, decisionId: d.id }, 'appending the decision to the knowledge base failed');
      }
    }
    return answered;
  }

  // ---------- service ----------

  return {
    create,
    get,

    list(filter = {}) {
      const where: string[] = ['workspace_id = ?'];
      const params: Array<string | number> = [ws];
      if (filter.status?.length) { where.push(`status IN (${filter.status.map(() => '?').join(',')})`); params.push(...filter.status); }
      if (filter.owner) { where.push('owner = ?'); params.push(filter.owner); }
      if (filter.ticketId) { where.push('ticket_id = ?'); params.push(filter.ticketId); }
      const limit = Math.min(filter.limit ?? 100, 500);
      return db
        .all<Record<string, unknown>>(`SELECT * FROM decisions WHERE ${where.join(' AND ')} ORDER BY created_at DESC LIMIT ?`, [...params, limit])
        .map(asDecision);
    },

    answer,

    withdraw(actor, id, reason) {
      const d = get(id);
      if (d.status !== 'open') throw new OcError('wrong_status', `decision ${id} is ${d.status}`);
      return tx(db, () => {
        db.update('decisions', d.id, { status: 'withdrawn' as DecisionStatus, answerText: reason });
        const next = get(d.id);
        recordActivity(db, ws, actor, 'decision.withdraw', 'decision', d.id, { reason }, d.ticketId);
        ctx.events.emit('decision.answered', 'decision', d.id, next);
        return next;
      });
    },

    supersedeForTarget(actor, ticketId, correlationKey) {
      return tx(db, () => supersedeOpen(actor, ticketId, correlationKey));
    },

    async expireDue() {
      const now = nowIso();
      const due = db
        .all<Record<string, unknown>>('SELECT * FROM decisions WHERE workspace_id = ? AND status = ? AND expires_at IS NOT NULL AND expires_at <= ?', [ws, 'open', now])
        .map(asDecision);
      const actor: Actor = { kind: 'system', id: null };
      const out: Decision[] = [];
      for (const d of due) {
        tx(db, () => {
          db.update('decisions', d.id, { status: 'expired' as DecisionStatus });
          recordActivity(db, ws, actor, 'decision.expired', 'decision', d.id, { kind: d.kind }, d.ticketId);
          ctx.events.emit('decision.expired', 'decision', d.id, get(d.id));
        });
        out.push(get(d.id));
        const unblock = { owner: (d.owner === 'conductor' ? 'conductor' : 'human') as 'conductor' | 'human', action: `answer the expired decision "${d.title}"` };
        if (d.ticketId) {
          try {
            await deps().tickets.transition(actor, d.ticketId, { to: 'blocked', note: `Decision expired: ${d.title}`, unblock });
          } catch {
            db.update('tickets', d.ticketId, { unblockJson: unblock, updatedAt: nowIso() });
          }
        }
        wake(conductorId(), 'system', `decision expired: ${d.title}`, { decisionId: d.id, ticketId: d.ticketId });
      }
      return out;
    },
  };
}
