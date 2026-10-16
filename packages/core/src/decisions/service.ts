import { decisionRow, newId, nowIso, type Db } from '@weave-ai/db';
import { ASKABLE_DECISION_KINDS, carriesWeaverReview, OcError, TERMINAL_TICKET_STATUSES, WEAVER_REVIEW_KINDS, WEAVER_REVIEW_NOTE_MAX, WEAVER_REVIEW_WAITING_ON_MAX, NAMED_CARD_OPTION_KEYS, type Decision, type DecisionAnswerInputs, type DecisionInput, type DecisionKind, type DecisionOwner, type DecisionStatus, type RoleSpec, type TicketStatus } from '@weave-ai/shared';
import type { Actor, CoreServices, DecisionCreateInput, DecisionsService } from '../api.js';
import type { WorkspaceContext } from '../context.js';
import { recordActivity } from '../events.js';
import { tx } from '../tickets/tx.js';
import { interruptRunForSteer, steerInterruptTarget } from '../runs/active.js';
import { WORKERS_RUNTIME_CORRELATION } from '../models/index.js';

const asDecision = (r: Record<string, unknown>): Decision => decisionRow(r) as unknown as Decision;

/** A secret input's `secretName` becomes an environment variable name, so it has to be able to be one. */
const SECRET_NAME = /^[A-Z][A-Z0-9_]{0,63}$/;

/** Two SHAs name the same object when one is a prefix of the other (mirrors the tickets-service helper of the same name). */
function sameGitSha(a: string, b: string): boolean {
  const x = a.trim().toLowerCase();
  const y = b.trim().toLowerCase();
  if (x.length < 7 || y.length < 7) return x === y;
  return x === y || x.startsWith(y) || y.startsWith(x);
}

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
    return db.get<{ id: string }>("SELECT id FROM agents WHERE workspace_id = ? AND kind = 'weaver'", [ws])?.id ?? null;
  }
  /**
   * Whether the agent asking is a worker (VS-127) — a worker's ask is never the human's to answer.
   * VS-495: a persistent session's ask counts the same way while it holds a ticket (its turns are
   * then indistinguishable from a worker's); ticketless, its ask stays the human's, the same as the
   * weaver's own — there is no ticket-delivery reason to route it away from the direct conversation.
   */
  function askedByWorker(askedByAgentId: string | null | undefined): boolean {
    if (!askedByAgentId) return false;
    const agent = db.get<{ kind: string; ticketId: string | null }>('SELECT kind, ticket_id AS ticketId FROM agents WHERE id = ?', [askedByAgentId]);
    return agent?.kind === 'worker' || (agent?.kind === 'session' && agent.ticketId != null);
  }
  function wake(agentId: string | null | undefined, source: Parameters<CoreServices['wake']['enqueue']>[1]['source'], reason: string, payload: Record<string, unknown> = {}, idempotencyKey?: string): void {
    if (!agentId) return;
    try {
      deps().wake.enqueue(agentId, { source, reason, payload, ...(idempotencyKey ? { idempotencyKey } : {}) });
    } catch (e) {
      log.warn({ err: e, agentId, source }, 'wake enqueue failed');
    }
  }

  /**
   * Default owner per kind (PLAN §15), overridable per project for plan approvals only. `question`
   * and `concern` are the two askable kinds with no fixed owner: whoever is asking decides who
   * answers them (VS-127) — a worker's ask is always the conductor's, never the human's, so a
   * worker cannot land in the human's queue merely by naming a kind. `gate_finding` stays
   * unconditionally the conductor's regardless of who raises it, as it always has been.
   */
  function defaultOwner(kind: DecisionKind, ticketId: string | null | undefined, askedByAgentId?: string | null): DecisionOwner {
    switch (kind) {
      case 'gate_finding':
        return 'weaver';
      case 'question':
      case 'concern':
        return askedByWorker(askedByAgentId) ? 'weaver' : 'human';
      case 'merge_approval':
      case 'action_approval':
        return 'human';
      case 'hire_approval':
        // `hireApproval` is `APPROVAL_OWNERS`, not `DecisionOwner`; translated here, at the one point
        // it becomes a decision. `ctx.config` is always schema-normalized (VS-263: the schema accepts
        // the on-disk legacy `'conductor'` spelling but resolves it to `'weaver'` at parse time), so
        // this reads the current value, not the legacy one.
        return ctx.config.defaults.hireApproval === 'weaver' ? 'weaver' : 'human';
      case 'plan_approval': {
        // Same translation, but `owner` may come from either of two sources with different
        // normalization: `ctx.config.defaults.proposalApproval` is always schema-normalized (never
        // the legacy spelling); `p.policies_json` is a raw DB column VS-263 deliberately keeps
        // writing under the legacy `'conductor'` spelling (Decision 6 — rollback safety), so it can
        // still be that literal value here. Accept either.
        const p = ticketId
          ? db.get<{ policies: { proposalApproval?: 'human' | 'conductor' | 'weaver' | 'none' } | null }>(
              'SELECT p.policies_json FROM tickets t JOIN projects p ON p.id = t.project_id WHERE t.id = ?', [ticketId])
          : null;
        const owner = p?.policies?.proposalApproval ?? ctx.config.defaults.proposalApproval;
        return owner === 'conductor' || owner === 'weaver' ? 'weaver' : 'human';
      }
      default:
        return 'human';
    }
  }

  /**
   * Every still-open decision scoped to `ticketId`, withdrawn with `reason` (VS-142: a ticket that
   * reaches done/cancelled leaves nothing open behind it). `createdBefore` (VS-306) narrows it to
   * decisions older than that instant, so the stale-terminal sweep can reuse this closure path
   * without touching a follow-up asked yesterday that is still within its grace period.
   */
  function withdrawOpenForTicket(actor: Actor, ticketId: string, reason: string, createdBefore?: string): number {
    const rows = createdBefore
      ? db.all<{ id: string }>("SELECT id FROM decisions WHERE workspace_id = ? AND ticket_id = ? AND status = ? AND created_at <= ? AND NOT (kind = 'merge_approval' AND correlation_key LIKE 'merge_approval:archive:%')", [ws, ticketId, 'open', createdBefore])
      : db.all<{ id: string }>("SELECT id FROM decisions WHERE workspace_id = ? AND ticket_id = ? AND status = ? AND NOT (kind = 'merge_approval' AND correlation_key LIKE 'merge_approval:archive:%')", [ws, ticketId, 'open']);
    for (const r of rows) {
      db.update('decisions', r.id, { status: 'withdrawn' as DecisionStatus, answerText: reason });
      recordActivity(db, ws, actor, 'decision.withdraw', 'decision', r.id, { reason }, ticketId);
      ctx.events.emit('decision.answered', 'decision', r.id, get(r.id));
    }
    return rows.length;
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

  /**
   * The decision that replaced a superseded one, if it is still open — `create()` always supersedes
   * every open decision under a correlation key before inserting the new one, so at most one can
   * exist. Used only to tell a stale answer which card to point the human at (VS-140).
   */
  function replacementFor(d: Decision): string | null {
    if (!d.correlationKey) return null;
    return db.get<{ id: string }>(
      'SELECT id FROM decisions WHERE workspace_id = ? AND ticket_id IS ? AND correlation_key = ? AND status = ?',
      [ws, d.ticketId, d.correlationKey, 'open'],
    )?.id ?? null;
  }

  /**
   * VS-625: close one decision as `superseded` because the situation it described has been
   * overtaken, recording `reason` — unlike `create()`'s correlation-key supersede, which has a
   * replacement card to point at and no reason of its own. Refuses anything not `open`, so an
   * answered card is never rewritten.
   */
  function supersede(actor: Actor, id: string, reason: string): Decision {
    const d = get(id);
    if (d.status !== 'open') throw new OcError('wrong_status', `decision ${id} is ${d.status}`);
    return tx(db, () => {
      db.update('decisions', d.id, { status: 'superseded' as DecisionStatus, answerText: reason });
      const next = get(d.id);
      recordActivity(db, ws, actor, 'decision.superseded', 'decision', d.id, { reason }, d.ticketId);
      ctx.events.emit('decision.superseded', 'decision', d.id, next);
      return next;
    });
  }

  /** The supervisor's per-worker stall escalation lives under this correlation key. */
  const stalledWorkerKey = (workerId: string): string => `stalled-worker:${workerId}`;

  /**
   * VS-625: every open card that says this worker is stopped — its parking `retry_approval` and the
   * supervisor's stalled-worker `gate_finding` — closed because the worker has been put back to
   * work. Matched on the worker the card names, never on the ticket, so nothing about another agent
   * is touched; a card the human has already answered is not open and so is never rewritten.
   */
  function supersedeWorkerStopCards(actor: Actor, workerId: string, reason: string): number {
    const rows = db
      .all<Record<string, unknown>>("SELECT * FROM decisions WHERE workspace_id = ? AND status = 'open'", [ws])
      .map(asDecision);
    let closed = 0;
    for (const d of rows) {
      const parking = d.kind === 'retry_approval' && (d.target as { agentId?: string } | null)?.agentId === workerId;
      const stalled = d.kind === 'gate_finding' && d.correlationKey === stalledWorkerKey(workerId);
      if (!parking && !stalled) continue;
      try {
        supersede(actor, d.id, reason);
        closed += 1;
      } catch (e) {
        log.warn({ err: String(e), decisionId: d.id, workerId }, 'could not close a worker stop card');
      }
    }
    return closed;
  }

  /**
   * Which project a decision belongs to, resolved once here rather than derived on every read
   * (VS-92): the ticket's project wins and is not overridable — a card naming a project other than
   * its ticket's would be a lie — then the project the asker named, then the asker's own. Null is
   * the honest answer for a workspace-wide question, and every surface renders it as `Workspace`.
   */
  function resolveProject(input: DecisionCreateInput, ticketId: string | null): string | null {
    if (ticketId) return db.get<{ projectId: string | null }>('SELECT project_id FROM tickets WHERE id = ?', [ticketId])?.projectId ?? null;
    const named = input.projectId ?? null;
    if (!named) return null;
    if (!db.get('SELECT id FROM projects WHERE workspace_id = ? AND id = ?', [ws, named])) throw new OcError('not_found', `project ${named} not found`);
    return named;
  }

  /**
   * The shape a choice-carrying input has to have or the card could not render it or the answer
   * could not validate: at least the type's minimum of choices, unique non-empty keys, at most one
   * recommendation, and a default the input actually offers (VS-342). A recommendation the human
   * never sees pre-selected, or a default the answer then refuses, is caught here where the asker
   * can still fix the card.
   */
  function validateChoiceInput(key: string, input: DecisionInput): void {
    const choices = input.choices ?? [];
    const min = input.type === 'single_choice' ? 2 : 1;
    if (choices.length < min) {
      throw new OcError('validation', input.type === 'single_choice'
        ? `single_choice input "${key}" needs at least two choices`
        : `multiselect input "${key}" needs at least one choice`);
    }
    const keys = new Set<string>();
    for (const c of choices) {
      if (!(c.key ?? '').trim()) throw new OcError('validation', `every choice of input "${key}" needs a key`);
      if (keys.has(c.key)) throw new OcError('validation', `input "${key}" repeats the choice "${c.key}"`);
      keys.add(c.key);
    }
    if (choices.filter((c) => c.recommended === true).length > 1) {
      throw new OcError('validation', `input "${key}" recommends more than one choice`);
    }
    if (input.default !== undefined) {
      const defaults = Array.isArray(input.default) ? input.default : [input.default];
      for (const d of defaults) {
        if (!keys.has(d)) throw new OcError('validation', `input "${key}" defaults to a choice it does not offer: "${d}"`);
      }
    }
  }

  /**
   * Refuse a card that could not be answered, before the row exists. Everything here is a shape the
   * card has to render or the answer has to validate against; a decision that reaches the human
   * with a multi-select and no choices is a dead end with no way back for either of them.
   */
  function validateInputs(inputs: DecisionInput[]): DecisionInput[] {
    const seen = new Set<string>();
    for (const i of inputs) {
      const key = (i.key ?? '').trim();
      if (!key) throw new OcError('validation', 'every decision input needs a key');
      if (seen.has(key)) throw new OcError('validation', `two decision inputs share the key "${key}"`);
      seen.add(key);
      if (!(i.label ?? '').trim()) throw new OcError('validation', `input "${key}" needs a label`);
      if (i.type === 'single_choice' || i.type === 'multiselect') {
        validateChoiceInput(key, i);
      } else if (i.default !== undefined) {
        // A secret has nothing safe to pre-fill, and a text default has to be one string.
        if (i.type === 'secret') throw new OcError('validation', `secret input "${key}" cannot carry a default`);
        if (typeof i.default !== 'string') throw new OcError('validation', `input "${key}" default must be a string`);
      }
      // The value never becomes the answer, so the name it is stored under is the only thing that
      // can carry it onward — and it has to be usable as an environment variable name.
      if (i.type === 'secret' && !SECRET_NAME.test(i.secretName ?? '')) {
        throw new OcError('validation', `secret input "${key}" needs a secretName matching ${SECRET_NAME.source}`);
      }
    }
    return inputs;
  }

  function create(actor: Actor, input: DecisionCreateInput): Decision {
    const requestedTicketId = input.ticketId ?? null;
    const ticket = requestedTicketId
      ? db.get<{ id: string; status: TicketStatus; projectId: string | null }>('SELECT id, status, project_id FROM tickets WHERE id = ?', [requestedTicketId])
      : null;
    if (requestedTicketId && !ticket) throw new OcError('not_found', `ticket ${requestedTicketId} not found`);
    // VS-306: a decision named at an already-terminal ticket has no future terminal transition to
    // ride, so it is created with no ticket attachment rather than left orphaned. The ask stays
    // legitimate (a follow-up on a finished ticket), so it is created, not refused. The project AND
    // the correlation key are both derived from the original ticket before the attachment is
    // dropped: the key must stay derived from that ticket (`kind:<owner>:<ticketId>`, VS-519) so the
    // detached card keeps its own bucket and neither supersedes nor is superseded by a workspace-level
    // decision of the same kind.
    const terminal = ticket ? (TERMINAL_TICKET_STATUSES as readonly string[]).includes(ticket.status) : false;
    // VS-389: an archive-backfill merge approval belongs on the finished ticket whose archive it
    // lands. It is the one card allowed to keep a terminal ticket's attachment, and only when the
    // caller explicitly asks and the target names an archive pull request.
    const attachArchiveToTerminal = terminal && input.attachToTerminal === true && input.kind === 'merge_approval' && !!(input.target?.['archive']);
    if (terminal && !attachArchiveToTerminal) log.warn({ ticketId: requestedTicketId, kind: input.kind }, 'decision created for an already-terminal ticket; dropping its ticket attachment');
    const ticketId = terminal && !attachArchiveToTerminal ? null : requestedTicketId;
    const projectId = resolveProject(input, requestedTicketId);
    const inputs = validateInputs(input.inputs ?? []);
    const owner = input.owner ?? defaultOwner(input.kind, requestedTicketId, input.askedByAgentId);
    // VS-519: the derived bucket is scoped by the audience the ask is put to (`owner`), not just its
    // kind and ticket. A worker's question (owner `weaver`) and the weaver's escalation of it (owner
    // `human`) are different objects with different audiences, so they must not share a bucket —
    // otherwise the escalation supersedes the worker's card and the answer can never be relayed back.
    // A repeat ask of the same kind by the same owner on the same ticket still supersedes. Callers
    // passing an explicit key are unchanged; their cross-owner republish supersede is intentional.
    const id = newId();
    // VS-727: a ticketless askable-kind decision (`weave_ask`'s own use, with no ticket to attach —
    // the weaver's own asks, and a ticketless session's) has no ticket to make its bucket unique, so
    // `requestedTicketId ?? 'workspace'` used to put every ticketless card of a kind and owner —
    // regardless of which project it was about — in the same bucket, and a second one silently
    // superseded the first. Scoped to the three kinds `weave_ask` can actually raise: every
    // system-owned kind (`retry_approval`, `hire_approval`, ...) already passes its own explicit
    // `correlationKey` at every call site (see design.md's caller audit), so leaving their default
    // untouched changes nothing for them today and avoids a future ticketless system call silently
    // inheriting per-call uniqueness it never asked for.
    const ticketlessAskableKind = !requestedTicketId && (ASKABLE_DECISION_KINDS as readonly string[]).includes(input.kind);
    const correlationKey = input.correlationKey ?? (ticketlessAskableKind
      ? `${input.kind}:${owner}:workspace:${id}`
      : `${input.kind}:${owner}:${requestedTicketId ?? 'workspace'}`);
    const now = nowIso();
    return tx(db, () => {
      supersedeOpen(actor, ticketId, correlationKey);
      db.insert('decisions', {
        id, workspaceId: ws, ticketId, projectId, kind: input.kind, owner, askedByAgentId: input.askedByAgentId ?? null,
        askedInRunId: input.askedInRunId ?? actor.runId ?? null, title: input.title, context: input.context ?? '',
        optionsJson: input.options ?? [], inputsJson: inputs, allowFreeText: input.allowFreeText ?? true, recommendation: input.recommendation ?? null,
        status: 'open', expiresAt: input.expiresInHours ? new Date(Date.now() + input.expiresInHours * 3600e3).toISOString() : null,
        targetJson: input.target ?? null, correlationKey, createdAt: now,
      });
      const d = get(id);
      recordActivity(db, ws, actor, 'decision.create', 'decision', id, { kind: input.kind, owner, correlationKey }, ticketId);
      ctx.events.emit('decision.created', 'decision', id, d);
      // VS-361: a human-owned plan, merge or action approval carries the weaver's review (the same
      // predicate the review UI uses), so creating one wakes the weaver at once instead of leaving it
      // to the rate-limited digest. The weaver-owned wake below already covers a card the weaver
      // answers itself, and `askedByAgentId === weaver` means the weaver raised it, so neither calls
      // for a second wake. Keyed per decision (not per correlation key) so a re-raised card — a new
      // decision — still wakes, while enqueuing one decision twice cannot leave two live wakes.
      const cid = conductorId();
      if (owner === 'weaver') {
        wake(cid, 'system', `decision ${input.kind} awaits you`, { decisionId: id, ticketId });
      } else if (carriesWeaverReview(input.kind) && (input.askedByAgentId ?? null) !== cid) {
        wake(cid, 'system', `decision ${input.kind} awaits your review`, { decisionId: id, ticketId }, `decision-review:${id}`);
      }
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

  async function applyActionApproval(actor: Actor, d: Decision, key: string, text: string | null): Promise<void> {
    const ticketId = ticketOf(d);
    if (!ticketId) return;
    const tickets = deps().tickets;
    if (key === 'approve') {
      // Stay `in_progress`. `answer()` already wakes `askedByAgentId`.
      if (text) tickets.comment(actor, ticketId, `Action approved: ${text}`, 'comment', 'trusted');
      return;
    }
    if (key === 'revise') {
      if (text) tickets.comment(actor, ticketId, `Action revision requested: ${text}`, 'comment', 'trusted');
      return;
    }
    if (key === 'reject') {
      tickets.cancel(actor, ticketId, text ? `Action rejected: ${text}` : 'Action rejected.');
    }
  }

  async function applyMergeApproval(actor: Actor, d: Decision, key: string, text: string | null): Promise<void> {
    const ticketId = ticketOf(d);
    if (!ticketId) return;
    const tickets = deps().tickets;
    // VS-389: a card carrying an archive-backfill pull request lands that pull request instead of
    // moving the (already finished) ticket; the ticket stays `done`.
    const archive = archiveTargetOf(d);
    if (archive) {
      if (key === 'approve') await tickets.landArchiveBackfill(actor, { ticketId, ...archive });
      else tickets.declineArchiveBackfill(actor, { ticketId, ...archive, text });
      return;
    }
    if (key === 'approve') {
      await tickets.transition(actor, ticketId, { to: 'merging', note: text ? `Merge approved: ${text}` : 'Merge approved.' });
    } else {
      if (text) tickets.comment(actor, ticketId, `Changes requested before merge: ${text}`, 'comment', 'trusted');
      const t = tickets.get(ticketId);
      if (t.status === 'in_review') await tickets.transition(actor, ticketId, { to: 'in_progress', note: 'Changes requested by the reviewer.' });
    }
  }

  /**
   * VS-389: the archive-backfill pull request a merge card names, when it carries one. Its presence
   * is what makes the card land an archive rather than transition the ticket.
   */
  function archiveTargetOf(d: Decision): { changeName: string; branch: string; prUrl: string } | null {
    const raw = d.target?.['archive'];
    if (!raw || typeof raw !== 'object') return null;
    const a = raw as Record<string, unknown>;
    if (typeof a['changeName'] !== 'string' || typeof a['branch'] !== 'string' || typeof a['prUrl'] !== 'string') return null;
    return { changeName: a['changeName'], branch: a['branch'], prUrl: a['prUrl'] };
  }

  async function applyHireApproval(actor: Actor, d: Decision, key: string): Promise<void> {
    const target = (d.target ?? {}) as { roleId?: string; permissionChange?: boolean; patch?: Partial<RoleSpec>; reason?: string; applyToRunning?: boolean };
    const roleId = target.roleId;
    if (!roleId) {
      log.warn({ decisionId: d.id }, 'hire_approval without target.roleId; nothing to activate');
      return;
    }
    if (key === 'reject' || key === 'decline') return;
    // VS-335: a permission change raises the same kind as a hire but must not activate the (already
    // live) role or start the project's describe scout; it applies the patch the card carried.
    if (target.permissionChange) {
      await deps().roles.update(actor, roleId, target.patch ?? {}, target.reason ?? 'permission change approved', { applyToRunning: target.applyToRunning === true });
      return;
    }
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
    // VS-625: the resume that cancels this card out normally closes it first, but an answer can
    // still be in flight when the worker goes back to work. A card describing a worker that is no
    // longer stopped acts on nothing: no second turn, no booked retry, no model switch. The answer
    // is already recorded, so say on the ticket why nothing happened rather than discard it.
    const current = db.get<{ status: string }>('SELECT status FROM agents WHERE id = ?', [target.agentId]);
    if (current && current.status !== 'paused') {
      recordActivity(db, ws, actor, 'decision.retry_stale', 'decision', d.id, { key, agentStatus: current.status }, d.ticketId);
      if (d.ticketId) {
        try {
          deps().tickets.comment({ kind: 'system', id: null }, d.ticketId,
            `The retry card was answered after the worker had already resumed; nothing was started (the worker is ${current.status}).`,
            'status', 'trusted');
        } catch { /* the ticket record is best effort; the activity above already holds it */ }
      }
      return;
    }
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
    if (key.startsWith('switch:')) {
      if (!target.ticketId) return;
      deps().tickets.setWorkerModelFromQuotaCard(actor, target.ticketId, key.slice('switch:'.length));
      deps().workers.resume(actor, target.agentId);
      return;
    }
    await deps().workers.relaunch(actor, target.agentId, 'the human asked for a retry');
    if (target.ticketId) {
      const t = deps().tickets.get(target.ticketId);
      if (t.status === 'blocked') await deps().tickets.transition(actor, t.id, { to: (t.blockedFromStatus ?? 'todo') as TicketStatus, note: 'retrying' }).catch(() => undefined);
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

  /**
   * The values a card collected, checked against what the decision actually asked for. Returns the
   * map to record — empty optional inputs dropped, and every `secret` still holding its raw value,
   * which `settleSecrets` replaces with the name before anything is written.
   */
  function validateAnswerInputs(d: Decision, supplied: DecisionAnswerInputs): DecisionAnswerInputs {
    const declared = new Map((d.inputs ?? []).map((i) => [i.key, i]));
    for (const key of Object.keys(supplied)) {
      if (!declared.has(key)) throw new OcError('validation', `decision ${d.id} has no input "${key}"`, { inputs: [...declared.keys()] });
    }
    const out: DecisionAnswerInputs = {};
    for (const input of declared.values()) {
      const raw = supplied[input.key];
      const empty = raw === undefined || raw === null || (typeof raw === 'string' && raw.trim() === '') || (Array.isArray(raw) && raw.length === 0);
      if (empty) {
        if (input.required) throw new OcError('validation', `input "${input.key}" (${input.label}) is required`);
        continue; // An optional input left empty is absent, never present and empty.
      }
      if (input.type === 'single_choice') {
        // VS-342: the chosen key, or — only when the input allows it — the human's own words.
        if (Array.isArray(raw)) throw new OcError('validation', `input "${input.key}" takes a single value`);
        const offered = (input.choices ?? []).map((c) => c.key);
        if (!offered.includes(raw) && !input.allowOther) {
          throw new OcError('validation', `"${raw}" is not a choice of input "${input.key}"`, { choices: offered });
        }
        out[input.key] = raw;
      } else if (input.type === 'multiselect') {
        const chosen = Array.isArray(raw) ? raw : [raw];
        const offered = (input.choices ?? []).map((c) => c.key);
        for (const c of chosen) {
          if (!offered.includes(c)) throw new OcError('validation', `"${c}" is not a choice of input "${input.key}"`, { choices: offered });
        }
        // Recorded in the order the choices were offered, so two humans picking the same set record the same thing.
        out[input.key] = offered.filter((c) => chosen.includes(c));
      } else {
        if (Array.isArray(raw)) throw new OcError('validation', `input "${input.key}" takes a single value`);
        out[input.key] = raw;
      }
    }
    return out;
  }

  /**
   * Register every secret input's value and replace it with the name it was stored under, so what
   * the answer records is a reference and never a credential.
   *
   * This runs *before* the answer is written, inverting this service's usual record-then-side-effect
   * order. That order exists so a failing side effect never loses an answer; here it would do the
   * opposite — record a decision claiming a credential was collected that nobody holds. A failed
   * registration throws, nothing is recorded, and the decision stays open for another try.
   */
  function settleSecrets(actor: Actor, d: Decision, values: DecisionAnswerInputs): DecisionAnswerInputs {
    const out: DecisionAnswerInputs = { ...values };
    for (const input of d.inputs ?? []) {
      if (input.type !== 'secret') continue;
      const value = out[input.key];
      if (typeof value !== 'string' || value === '') continue; // Absent means optional and skipped; validation already refused a missing required one.
      deps().secrets.put(actor, { name: input.secretName!, envVarName: input.secretName!, scope: 'workspace' }, value);
      out[input.key] = input.secretName!;
    }
    return out;
  }

  /** The option key that moves a review-carrying kind's ticket forward — the one this hold applies to. Every carrying kind currently names it `approve`, but this reads the contract rather than assuming it stays that way. */
  function approvingKeyOf(kind: DecisionKind): string | null {
    if (!(WEAVER_REVIEW_KINDS as readonly string[]).includes(kind)) return null;
    return (NAMED_CARD_OPTION_KEYS as Record<string, { approve?: string }>)[kind]?.approve ?? null;
  }

  /**
   * VS-310: a relayed answer is the human's words, transcribed by the weaver from the message they
   * were sent in. Only the weaver may do this — enforced here rather than left to the tool's
   * `scope`, so a worker cannot fabricate an answer the human never gave. The decision must be
   * human-owned (a relay names the human's message), and the message must be an inbound human
   * message in one of this workspace's threads. Scoping in the query itself (not checked after the
   * fact) is the pattern `threads.message()` already uses: an unknown id and a row from another
   * workspace come back as one `not_found`.
   */
  function validateRelayMessage(actor: Actor, d: Decision, messageId: string): { id: string } {
    if (actor.kind !== 'agent' || !actor.id || actor.id !== conductorId()) {
      throw new OcError('forbidden', "only the workspace weaver can record an answer from the human's message");
    }
    if (d.owner !== 'human') {
      throw new OcError('validation', `decision ${d.id} is owned by the weaver and is answered directly`);
    }
    const m = db.get<{ id: string; direction: string; authorKind: string }>(
      `SELECT m.* FROM thread_messages m
         JOIN channel_threads t ON t.id = m.thread_id
         JOIN channels c ON c.id = t.channel_id
        WHERE m.id = ? AND c.workspace_id = ?`,
      [messageId, ws],
    );
    if (!m) throw new OcError('not_found', `relay message ${messageId} not found in this workspace`);
    if (m.direction !== 'inbound') throw new OcError('validation', 'a relayed answer must name an inbound message from the human');
    if (m.authorKind !== 'human') throw new OcError('validation', 'a relayed answer must name a message authored by the human');
    return m;
  }

  async function answer(
    actor: Actor,
    id: string,
    ans: { key?: string; text?: string; remember?: boolean; inputs?: DecisionAnswerInputs; overrideHold?: boolean; overrideReason?: string; relayFromMessageId?: string; dictated?: boolean },
  ): Promise<Decision> {
    const d = get(id);
    if (d.status !== 'open') {
      const supersededBy = d.status === 'superseded' ? replacementFor(d) : null;
      throw new OcError('wrong_status', `decision ${id} is ${d.status}`, { status: d.status, ...(supersededBy ? { supersededBy } : {}) });
    }
    // VS-310: enforced here, not only in the tool's `scope: 'weaver'`, so no future caller can
    // fabricate a relay. Validated before any write and before the side effects below.
    const relayFrom = ans.relayFromMessageId ? validateRelayMessage(actor, d, ans.relayFromMessageId) : null;
    // VS-266 / VS-281 / VS-474: an approving answer on a still-open review-carrying decision is held
    // in three cases. The weaver marked `concerns` (VS-266 — every actor, including the system actor,
    // so an unattended merge cannot silently override a stated objection). Or the weaver has not
    // reviewed it yet (VS-281 — every actor: since VS-474 the daemon's own `system` grant is held too,
    // so YOLO can never skip the review). Or (VS-474) the daemon is granting a `merge_approval` whose
    // reviewed head no longer matches the head about to be landed — a push after the mark would
    // otherwise land a head nobody reviewed. The head guard is scoped to the system actor and to
    // `looked` cards, so every human answer keeps the behavior it has always had. Every other answer —
    // revise, reject, the non-approving merge option, any answer on a decision that is not held — is
    // untouched by this check.
    const approving = ans.key != null && ans.key === approvingKeyOf(d.kind);
    const reviewStatus = d.weaverReviewStatus ?? 'unseen';
    const hasConcerns = reviewStatus === 'concerns';
    const unreviewed = reviewStatus === 'unseen';
    let headMismatch = false;
    if (approving && reviewStatus === 'looked' && actor.kind === 'system' && d.kind === 'merge_approval') {
      const current = await deps().tickets.approvalDeliveryHead(d);
      headMismatch = !(d.weaverReviewedHeadSha && current && sameGitSha(d.weaverReviewedHeadSha, current));
    }
    const held = approving && (hasConcerns || unreviewed || headMismatch);
    const overrideReason = (ans.overrideReason ?? '').trim();
    const overridden = held && ans.overrideHold === true && overrideReason !== '';
    if (held && !overridden) {
      throw new OcError('revision_pending', headMismatch
        ? `decision ${id} is held: the weaver has not reviewed the current head yet`
        : hasConcerns
          ? `decision ${id} is held: the weaver has concerns and no revision has landed`
          : `decision ${id} is held: the weaver has not reviewed it yet`, {
        weaverReviewStatus: reviewStatus,
        ...(headMismatch ? { weaverReviewHeadMismatch: true, weaverReviewedHeadSha: d.weaverReviewedHeadSha } : {}),
        ...(hasConcerns ? { weaverReviewNote: d.weaverReviewNote, weaverReviewedAt: d.weaverReviewedAt } : {}),
      });
    }
    const suppliedInputs = ans.inputs ?? {};
    const hasInputs = (d.inputs ?? []).length > 0;
    if (!hasInputs && Object.keys(suppliedInputs).length) throw new OcError('validation', `decision ${id} asks for no inputs`);
    // A card that only collects values is answered by filling them in: requiring a key or free text
    // as well would make an inputs-only decision unanswerable.
    if (!ans.key && !ans.text && !hasInputs) throw new OcError('validation', 'an answer needs a key or free text');
    // No `runtime:` escape hatch (VS-77): a card cannot move one agent onto another runtime, so an
    // answer that is not one of the offered options is a validation error again.
    if (ans.key && d.options.length && !d.options.some((o) => o.key === ans.key)) {
      throw new OcError('validation', `unknown option "${ans.key}"`, { options: d.options.map((o) => o.key) });
    }
    if (!ans.key && !d.allowFreeText && !hasInputs) throw new OcError('validation', 'this decision requires one of its options');

    // Validate, then settle the secrets, then record — in that order, and all of it before the row
    // is touched: nothing about this answer is written until every value has somewhere to live.
    const checked = hasInputs ? validateAnswerInputs(d, suppliedInputs) : {};
    const answerInputs = hasInputs ? settleSecrets(actor, d, checked) : null;

    const key = ans.key ?? null;
    const text = ans.text ?? null;
    // VS-568: the promotion push happens before the answer is recorded, so a refusal (not a
    // fast-forward, head moved, remote rejected) leaves the card open. Human-only, never the daemon's
    // own grant: `execute` refuses any other actor.
    if (d.kind === 'promotion_approval' && approving) await deps().promotion.execute(actor, d);
    const answered = tx(db, () => {
      db.update('decisions', d.id, {
        status: 'answered' as DecisionStatus, answerKey: key, answerText: text, answerInputsJson: answerInputs,
        answeredByKind: actor.kind, answeredById: actor.id, answeredAt: nowIso(),
        ...(relayFrom ? { answerAuthorKind: 'human', relayedFromMessageId: relayFrom.id } : {}),
      });
      const next = get(d.id);
      recordActivity(db, ws, actor, 'decision.answer', 'decision', d.id, { key, kind: d.kind }, d.ticketId);
      if (overridden) recordActivity(db, ws, actor, 'decision.hold_overridden', 'decision', d.id, { reason: overrideReason, weaverReviewStatus: reviewStatus }, d.ticketId);
      ctx.events.emit('decision.answered', 'decision', d.id, next);
      return next;
    });

    // Recorded in the audit trail above; also surfaced in-place on the ticket, since that is where a
    // human reading back "why did this merge/approve without a revision" would look first (VS-266).
    if (overridden && d.ticketId) {
      deps().tickets.comment(actor, d.ticketId, `Approval held by the weaver's ${hasConcerns ? 'concerns' : 'pending review'} was overridden: ${overrideReason}`, 'comment', 'trusted');
    }

    // Verbatim answer text is already recorded; side effects come second so a failure never loses the answer.
    const effective = key ?? '';
    try {
      switch (d.kind) {
        case 'plan_approval': await applyPlanApproval(actor, answered, effective, text); break;
        case 'action_approval': await applyActionApproval(actor, answered, effective, text); break;
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
      // VS-662: an answered decision is a steer — if the worker's turn is executing, interrupt it so
      // the answer is delivered on the resumed turn instead of queued behind the running one. The
      // answer also rides in the wake payload for the prompt (Decision 7 in the change's design).
      const interruptRunId = steerInterruptTarget(ctx, answered.askedByAgentId);
      wake(answered.askedByAgentId, 'decision_answered', `decision answered: ${answered.title}`, {
        decisionId: answered.id, answer: { key, text }, ticketId: answered.ticketId,
        // VS-657: a free-text answer entered by dictation is delivered with the mark; the stored
        // answer text is unchanged.
        ...(ans.dictated ? { dictated: true } : {}),
        // Already settled: a secret's entry here is the name it was stored under, never the value.
        ...(answerInputs ? { answerInputs } : {}),
        ...(interruptRunId ? { interruptedRunId: interruptRunId } : {}),
      });
      if (interruptRunId) interruptRunForSteer(ctx, deps, actor, interruptRunId);
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

  /**
   * Asserted conductor review (VS-223). The mark is a dedicated write, never inferred from a digest
   * or a turn. `answer()` does not read these columns.
   *
   * VS-474: after a `looked` mark, the tickets service is asked to grant the card when its project
   * runs under YOLO — this is the single place the daemon's own grant is released, so every
   * auto-approve caller (the plan raise/repair/republish, the merge sweep, the archive raise) is
   * covered without its own review logic. A grant failure never fails the review write.
   */
  async function review(actor: Actor, id: string, input: { status: 'looked' | 'concerns'; note?: string; reviewedHead?: string | null; waitingOn?: string | null }): Promise<Decision> {
    const d = get(id);
    const cid = conductorId();
    if (actor.kind !== 'agent' || !actor.id || actor.id !== cid) {
      throw new OcError('forbidden', 'only the workspace weaver can mark a decision reviewed');
    }
    if (!(WEAVER_REVIEW_KINDS as readonly string[]).includes(d.kind)) {
      throw new OcError('validation', `decision kind ${d.kind} does not carry weaver review`);
    }
    if (d.status !== 'open' && d.status !== 'answered') {
      throw new OcError('wrong_status', `decision ${id} is ${d.status}`, { status: d.status });
    }
    if (input.status !== 'looked' && input.status !== 'concerns') {
      throw new OcError('validation', 'review status must be looked or concerns');
    }
    // VS-234: both marks cost a written reason — the concern's summary, or the clean mark's stated
    // reason the work is clean (the sentence that would otherwise go to the chat). Either replaces
    // whatever a previous mark left.
    const trimmed = (input.note ?? '').trim();
    if (!trimmed) {
      throw new OcError('validation', input.status === 'looked'
        ? 'looked requires a note: state why the work is clean'
        : 'concerns requires a note');
    }
    if (trimmed.length > WEAVER_REVIEW_NOTE_MAX) {
      throw new OcError('validation', `review note is at most ${WEAVER_REVIEW_NOTE_MAX} characters`);
    }
    const note = trimmed;
    // VS-481: an optional one-line statement of what the mark is waiting on (runner CI, a dependency).
    // Informational only — it never gates or answers. An absent/blank value clears any previous one.
    const waitingOn = (input.waitingOn ?? '').trim() || null;
    if (waitingOn && waitingOn.length > WEAVER_REVIEW_WAITING_ON_MAX) {
      throw new OcError('validation', `waiting on is at most ${WEAVER_REVIEW_WAITING_ON_MAX} characters`);
    }
    const marked = tx(db, () => {
      db.update('decisions', d.id, {
        weaverReviewStatus: input.status,
        weaverReviewedAt: nowIso(),
        weaverReviewNote: note,
        weaverReviewWaitingOn: waitingOn,
        weaverReviewedByAgentId: actor.id,
        // VS-365: the delivery head this review was made against, so a held merge approval whose head
        // later moves can wake the weaver. Null when the caller could not resolve one.
        weaverReviewedHeadSha: input.reviewedHead ?? null,
      });
      const next = get(d.id);
      recordActivity(db, ws, actor, 'decision.review', 'decision', d.id, { status: input.status }, d.ticketId);
      ctx.events.emit('decision.updated', 'decision', d.id, next);
      return next;
    });
    if (marked.status === 'open' && marked.weaverReviewStatus === 'looked') {
      try {
        await deps().tickets.onReviewLooked(marked.id);
      } catch (e) {
        log.warn({ err: e, decisionId: marked.id }, 'granting a reviewed YOLO approval failed');
      }
    }
    return marked;
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

    review,

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

    dismiss(actor, id, reason) {
      if (actor.kind !== 'human') throw new OcError('forbidden', 'only a human can dismiss a decision card');
      const d = get(id);
      if (d.status !== 'open') throw new OcError('wrong_status', `decision ${id} is ${d.status}`, { status: d.status });
      if (!(ASKABLE_DECISION_KINDS as readonly string[]).includes(d.kind)) {
        throw new OcError('forbidden', `a ${d.kind} card cannot be dismissed; only ${ASKABLE_DECISION_KINDS.join(', ')} cards can`);
      }
      const why = (reason ?? '').trim();
      const dismissed = tx(db, () => {
        db.update('decisions', d.id, {
          status: 'withdrawn' as DecisionStatus, answerText: why,
          answeredByKind: actor.kind, answeredById: actor.id, answeredAt: nowIso(),
        });
        const next = get(d.id);
        recordActivity(db, ws, actor, 'decision.dismiss', 'decision', d.id, { reason: why }, d.ticketId);
        ctx.events.emit('decision.answered', 'decision', d.id, next);
        return next;
      });
      // A dismissal is a `decision_answered` wake marked `dismissed` with no `answer`: it already
      // steers a running turn and resolves a block, and the asker's prompt tells it apart.
      if (dismissed.askedByAgentId) {
        const interruptRunId = steerInterruptTarget(ctx, dismissed.askedByAgentId);
        wake(dismissed.askedByAgentId, 'decision_answered', `decision dismissed: ${dismissed.title}`, {
          decisionId: dismissed.id, dismissed: true, ticketId: dismissed.ticketId,
          ...(why ? { reason: why } : {}),
          ...(interruptRunId ? { interruptedRunId: interruptRunId } : {}),
        });
        if (interruptRunId) interruptRunForSteer(ctx, deps, actor, interruptRunId);
      }
      return dismissed;
    },

    supersedeForTarget(actor, ticketId, correlationKey) {
      return tx(db, () => supersedeOpen(actor, ticketId, correlationKey));
    },

    supersede,

    supersedeWorkerStopCards,

    withdrawForTicket(actor, ticketId, reason) {
      return tx(db, () => withdrawOpenForTicket(actor, ticketId, reason));
    },

    sweepTerminalTickets(actor, olderThanMs) {
      const cutoff = new Date(Date.now() - olderThanMs).toISOString();
      const placeholders = TERMINAL_TICKET_STATUSES.map(() => '?').join(', ');
      // Only decisions whose ticket is ALREADY terminal: a finished ticket cannot be waiting on a
      // gate, which is the whole reason this may run across every decision kind (VS-306). The
      // approval-integrity repair scan raises approvals only for non-terminal tickets, so the two
      // passes cannot contend. A decision newer than the cutoff is left so a just-asked follow-up is
      // readable before it is withdrawn.
      const stale = db.all<{ ticketId: string; identifier: string; status: TicketStatus }>(
        `SELECT DISTINCT d.ticket_id AS ticketId, t.identifier AS identifier, t.status AS status
           FROM decisions d JOIN tickets t ON t.id = d.ticket_id
          WHERE d.workspace_id = ? AND d.status = 'open' AND t.status IN (${placeholders}) AND d.created_at <= ?
            AND NOT (d.kind = 'merge_approval' AND d.correlation_key LIKE 'merge_approval:archive:%')`,
        [ws, ...TERMINAL_TICKET_STATUSES, cutoff],
      );
      let withdrawn = 0;
      for (const row of stale) {
        const reason = `${row.identifier} is ${row.status}; this decision was left open past its terminal-ticket grace period`;
        withdrawn += tx(db, () => withdrawOpenForTicket(actor, row.ticketId, reason, cutoff));
      }
      return withdrawn;
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
        const unblock = { owner: (d.owner === 'weaver' ? 'weaver' : 'human') as 'weaver' | 'human', action: `answer the expired decision "${d.title}"` };
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
