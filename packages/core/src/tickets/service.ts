import { newId, nowIso, ticketRow, type Db } from '@agent-conductor/db';
import {
  OcError, LIVENESS_STATUSES, TERMINAL_TICKET_STATUSES, estimateTokens,
  type CommentKind, type SourceTrust, type Ticket, type TicketComment, type TicketStatus, type WorkProductType,
} from '@agent-conductor/shared';
import type { Actor, CoreServices, Page, TicketCreateInput, TicketFilter, TicketsService, TransitionInput } from '../api.js';
import type { Project } from '@agent-conductor/shared';
import type { WorkspaceContext } from '../context.js';
import { recordActivity } from '../events.js';
import { checkTransition, openspecChangeName, type GuardFacts } from './guards.js';
import { tx } from './tx.js';
import { landDelivery, type LandResult } from './land.js';
import { existsSync } from 'node:fs';

function ticketBranchFor(t: { identifier: string; title: string }): string {
  const slug = t.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/, '');
  return `ac/${t.identifier.toLowerCase()}-${slug}`;
}

interface ProjectRow { id: string; slug: string; clonePath: string; openspecEnabled: number; policies: Record<string, unknown> | null }

const TERMINAL = new Set<TicketStatus>(TERMINAL_TICKET_STATUSES);

export function createTicketsService(ctx: WorkspaceContext, deps: () => CoreServices): TicketsService {
  const db: Db = ctx.db;
  const log = ctx.log('ticket');
  const ws = ctx.workspaceId;

  // ---------- reads ----------

  const row = (t: Record<string, unknown>): Ticket => ticketRow(t) as unknown as Ticket;

  function find(idOrIdentifier: string): Ticket | null {
    const r = db.get<Record<string, unknown>>(
      'SELECT * FROM tickets WHERE workspace_id = ? AND (id = ? OR identifier = ?)',
      [ws, idOrIdentifier, idOrIdentifier.toUpperCase()],
    );
    return r ? row(r) : null;
  }
  function get(idOrIdentifier: string): Ticket {
    const t = find(idOrIdentifier);
    if (!t) throw new OcError('not_found', `ticket ${idOrIdentifier} not found`);
    return t;
  }
  function project(id: string | null): ProjectRow | null {
    if (!id) return null;
    return db.get<ProjectRow>('SELECT id, slug, clone_path, openspec_enabled, policies_json FROM projects WHERE id = ?', [id]) ?? null;
  }
  function blockersOf(id: string): Ticket[] {
    return db
      .all<Record<string, unknown>>(
        'SELECT t.* FROM ticket_relations r JOIN tickets t ON t.id = r.related_ticket_id WHERE r.ticket_id = ? AND r.kind = ? ORDER BY t.number',
        [id, 'blocks'],
      )
      .map(row);
  }
  function dependentsOf(id: string): Ticket[] {
    return db
      .all<Record<string, unknown>>(
        'SELECT t.* FROM ticket_relations r JOIN tickets t ON t.id = r.ticket_id WHERE r.related_ticket_id = ? AND r.kind = ? ORDER BY t.number',
        [id, 'blocks'],
      )
      .map(row);
  }
  function childrenOf(id: string): Ticket[] {
    return db.all<Record<string, unknown>>('SELECT * FROM tickets WHERE parent_id = ? ORDER BY number', [id]).map(row);
  }
  function hasOpenDecision(ticketId: string): boolean {
    return !!db.get<{ n: number }>('SELECT COUNT(*) n FROM decisions WHERE ticket_id = ? AND status = ?', [ticketId, 'open'])?.n;
  }
  function hasWorkProduct(ticketId: string): boolean {
    return !!db.get<{ n: number }>('SELECT COUNT(*) n FROM ticket_work_products WHERE ticket_id = ?', [ticketId])?.n;
  }
  function mergeApproved(t: Ticket): boolean {
    if (t.autoMerge) return true;
    const d = db.get<{ n: number }>(
      "SELECT COUNT(*) n FROM decisions WHERE ticket_id = ? AND kind = 'merge_approval' AND status = 'answered' AND answer_key = 'approve'",
      [t.id],
    );
    return !!d?.n;
  }

  // ---------- helpers ----------

  function touch(id: string, patch: Record<string, unknown>): Ticket {
    db.update('tickets', id, { ...patch, updatedAt: nowIso() });
    return get(id);
  }

  function wake(agentId: string | null | undefined, source: Parameters<CoreServices['wake']['enqueue']>[1]['source'], reason: string, payload: Record<string, unknown> = {}): void {
    if (!agentId) return;
    try {
      deps().wake.enqueue(agentId, { source, reason, payload });
    } catch (e) {
      log.warn({ err: e, agentId, source }, 'wake enqueue failed');
    }
  }

  function conductorId(): string | null {
    return db.get<{ id: string }>("SELECT id FROM agents WHERE workspace_id = ? AND kind = 'conductor'", [ws])?.id ?? null;
  }

  /** Reject a blocker graph cycle: `id` must not be reachable from any of `blockedBy`. */
  function assertNoCycle(id: string, blockedBy: string[]): void {
    const seen = new Set<string>();
    const stack = [...blockedBy];
    while (stack.length) {
      const cur = stack.pop()!;
      if (cur === id) throw new OcError('validation', 'blocker cycle: a ticket cannot block itself, directly or transitively', { ticketId: id });
      if (seen.has(cur)) continue;
      seen.add(cur);
      for (const b of db.all<{ relatedTicketId: string }>('SELECT related_ticket_id FROM ticket_relations WHERE ticket_id = ?', [cur])) stack.push(b.relatedTicketId);
    }
  }

  function allocateNumber(): number {
    db.run('UPDATE workspaces SET ticket_counter = ticket_counter + 1, updated_at = ? WHERE id = ?', [nowIso(), ws]);
    const r = db.get<{ ticketCounter: number; ticketPrefix: string }>('SELECT ticket_counter, ticket_prefix FROM workspaces WHERE id = ?', [ws]);
    if (!r) throw new OcError('not_found', 'workspace row missing');
    return r.ticketCounter;
  }
  function prefix(): string {
    return db.get<{ ticketPrefix: string }>('SELECT ticket_prefix FROM workspaces WHERE id = ?', [ws])?.ticketPrefix ?? 'OC';
  }

  function bindOpenspec(t: Ticket): string | null {
    if (t.openspecChangeName) return t.openspecChangeName;
    const p = project(t.projectId);
    if (!p || !p.openspecEnabled) return null;
    if (t.kind === 'scout' || t.kind === 'question') return null;
    if (t.kind === 'task' && (p.policies as { taskTicketsUseOpenspec?: boolean } | null)?.taskTicketsUseOpenspec === false) return null;
    const name = openspecChangeName(t.identifier, t.title);
    db.update('tickets', t.id, { openspecChangeName: name, updatedAt: nowIso() });
    return name;
  }

  function approvalOwner(t: Ticket): 'human' | 'conductor' | 'none' {
    const p = project(t.projectId);
    const fromProject = (p?.policies as { proposalApproval?: 'human' | 'conductor' | 'none' } | null)?.proposalApproval;
    return fromProject ?? ctx.config.defaults.proposalApproval;
  }

  function systemComment(ticketId: string, body: string, actor: Actor, kind: CommentKind = 'status'): void {
    const id = newId();
    db.insert('ticket_comments', {
      id, ticketId, authorKind: actor.kind === 'human' ? 'human' : 'system', authorId: actor.id, runId: actor.runId ?? null,
      body, kind, sourceTrust: actor.kind === 'human' ? 'trusted' : 'trusted', createdAt: nowIso(),
    });
    ctx.events.emit('ticket.comment', 'ticket', ticketId, { id, ticketId, body, kind });
  }

  /** After a ticket becomes terminal: wake dependents and the parent (PLAN §7.1). */
  function propagateTerminal(t: Ticket, actor: Actor): void {
    for (const dep of dependentsOf(t.id)) {
      if (TERMINAL.has(dep.status)) continue;
      const open = blockersOf(dep.id).filter((b) => b.status !== 'done');
      if (open.length) continue;
      if (dep.status === 'blocked') {
        const back: TicketStatus = dep.assigneeRoleId || dep.workerId ? 'todo' : 'backlog';
        db.update('tickets', dep.id, { status: back, unblockJson: null, blockedTransitionAt: null, updatedAt: nowIso() });
        recordActivity(db, ws, actor, 'ticket.unblocked', 'ticket', dep.id, { from: 'blocked', to: back }, dep.id);
        ctx.events.emit('ticket.status', 'ticket', dep.id, get(dep.id));
      }
      wake(dep.workerId, 'blockers_resolved', `blockers resolved for ${dep.identifier}`, { ticketId: dep.id, resolvedBy: t.identifier });
    }
    if (t.parentId) {
      const kids = childrenOf(t.parentId);
      if (kids.length && kids.every((k) => TERMINAL.has(k.status))) {
        const parent = find(t.parentId);
        if (parent && !TERMINAL.has(parent.status)) {
          wake(parent.workerId, 'children_completed', `all children of ${parent.identifier} are complete`, { ticketId: parent.id });
        }
      }
    }
  }

  function facts(t: Ticket, input: TransitionInput): GuardFacts {
    const declared = input.blockedBy ?? [];
    const existing = blockersOf(t.id);
    const openBlockers = declared.length
      ? declared.filter((id) => find(id)?.status !== 'done').length
      : existing.filter((b) => b.status !== 'done').length;
    return {
      openBlockers,
      hasBlockers: declared.length > 0 || existing.length > 0,
      hasOpenDecision: hasOpenDecision(t.id),
      hasUnblockPath: !!input.unblock,
      hasWorkProduct: hasWorkProduct(t.id),
      mergeApproved: mergeApproved(t),
    };
  }

  // ---------- documents ----------

  function putDocument(actor: Actor, id: string, key: string, body: string): { documentId: string; revision: number } {
    const t = get(id);
    return tx(db, () => {
      let doc = db.get<{ id: string; currentRevision: number }>('SELECT id, current_revision FROM ticket_documents WHERE ticket_id = ? AND key = ?', [t.id, key]);
      if (!doc) {
        const docId = newId();
        db.insert('ticket_documents', { id: docId, ticketId: t.id, key, currentRevision: 0 });
        doc = { id: docId, currentRevision: 0 };
      }
      const revision = doc.currentRevision + 1;
      db.insert('ticket_document_revisions', {
        id: newId(), documentId: doc.id, revision, body, authorKind: actor.kind, authorId: actor.id, runId: actor.runId ?? null, createdAt: nowIso(),
      });
      db.run('UPDATE ticket_documents SET current_revision = ? WHERE id = ?', [revision, doc.id]);
      recordActivity(db, ws, actor, 'ticket.document', 'ticket_document', doc.id, { key, revision, tokens: estimateTokens(body) }, t.id);
      ctx.events.emit('ticket.document', 'ticket', t.id, { ticketId: t.id, documentId: doc.id, key, revision });
      // A newer plan revision supersedes a pending plan approval (PLAN §12.2).
      if (key === 'plan') {
        try {
          deps().decisions.supersedeForTarget(actor, t.id, `plan_approval:${t.id}`);
        } catch (e) {
          log.warn({ err: e, ticketId: t.id }, 'plan approval supersession failed');
        }
      }
      return { documentId: doc.id, revision };
    });
  }

  // ---------- transitions ----------

  async function transition(actor: Actor, id: string, input: TransitionInput): Promise<Ticket> {
    const t = get(id);
    const to = input.to;
    checkTransition(t.kind, t.status, to, facts(t, input));

    // Async gates run before the write transaction opens.
    let planBody: string | null = null;
    if (to === 'proposed' && t.kind === 'change') {
      const res = await deps().openspec.validateForProposed(t.id);
      if (!res.ok) {
        throw new OcError('openspec_validation_failed', 'OpenSpec planning is not complete or validation failed', { issues: res.issues });
      }
      planBody = res.plan;
    }

    const now = nowIso();
    const patch: Record<string, unknown> = { status: to };
    if (input.blockedBy) {
      assertNoCycle(t.id, input.blockedBy);
      tx(db, () => {
        db.run('DELETE FROM ticket_relations WHERE ticket_id = ? AND kind = ?', [t.id, 'blocks']);
        for (const b of input.blockedBy!) db.insert('ticket_relations', { ticketId: t.id, relatedTicketId: b, kind: 'blocks' });
      });
    }
    if (to === 'blocked') {
      patch.blockedTransitionAt = now;
      if (input.unblock) patch.unblockJson = input.unblock;
    } else {
      patch.unblockJson = null;
      patch.blockedTransitionAt = null;
    }
    if (!t.startedAt && (to === 'proposing' || to === 'in_progress')) patch.startedAt = now;
    if (to === 'done') patch.completedAt = now;
    if (to === 'cancelled') patch.cancelledAt = now;

    const next = tx(db, () => {
      const updated = touch(t.id, patch);
      if (planBody !== null) putDocument(actor, t.id, 'plan', planBody);
      if (input.note) systemComment(t.id, input.note, actor);
      recordActivity(db, ws, actor, 'ticket.transition', 'ticket', t.id, { from: t.status, to, note: input.note ?? null }, t.id);
      ctx.events.emit('ticket.status', 'ticket', t.id, updated);
      return updated;
    });

    // Post-transition side effects (decisions and wakes; both are idempotent-ish and coalesce).
    if (to === 'proposed' && t.kind === 'change') {
      const owner = approvalOwner(next);
      if (owner === 'none') return transition(actor, t.id, { to: 'approved', note: 'plan auto-approved by policy' });
      const doc = db.get<{ id: string; currentRevision: number }>('SELECT id, current_revision FROM ticket_documents WHERE ticket_id = ? AND key = ?', [t.id, 'plan']);
      deps().decisions.create(actor, {
        ticketId: t.id, kind: 'plan_approval', owner,
        title: `Approve the plan for ${next.identifier}: ${next.title}`,
        context: `OpenSpec change \`${next.openspecChangeName ?? ''}\` is planning-complete and validates. Review the plan document.`,
        options: [
          { key: 'approve', label: 'Approve', description: 'The worker implements the plan.', recommended: true },
          { key: 'revise', label: 'Revise', description: 'Send it back with feedback.' },
          { key: 'reject', label: 'Reject', description: 'Cancel the ticket.' },
        ],
        allowFreeText: true,
        correlationKey: `plan_approval:${t.id}`,
        target: doc ? { documentId: doc.id, revision: doc.currentRevision } : undefined,
        askedByAgentId: next.workerId,
        askedInRunId: actor.runId ?? null,
      });
    }
    if (to === 'in_review' && !next.autoMerge) {
      const wp = db.get<{ url: string | null; title: string | null }>('SELECT url, title FROM ticket_work_products WHERE ticket_id = ? ORDER BY created_at DESC LIMIT 1', [t.id]);
      deps().decisions.create(actor, {
        ticketId: t.id, kind: 'merge_approval', owner: 'human',
        title: `Approve the merge for ${next.identifier}: ${next.title}`,
        context: wp?.url ? `Work product: ${wp.url}` : 'The worker delivered its work product.',
        options: [
          { key: 'approve', label: 'Approve merge', recommended: true },
          { key: 'changes', label: 'Request changes', description: 'Send it back to the worker.' },
        ],
        allowFreeText: true,
        correlationKey: `merge_approval:${t.id}`,
        askedByAgentId: next.workerId,
        askedInRunId: actor.runId ?? null,
      });
    }
    if (to === 'in_review' && next.autoMerge) setTimeout(() => { service.autoMergeSweep().catch((e) => log.debug({ err: String(e) }, 'auto-merge sweep after in_review failed')); }, 50).unref();
    if (to === 'approved') wake(next.workerId, 'ticket_assigned', `plan approved for ${next.identifier}`, { ticketId: t.id });
    if (to === 'merging') wake(next.workerId, 'merge_approved', `merge approved for ${next.identifier}`, { ticketId: t.id });
    if (to === 'proposing' && t.status === 'proposed') wake(next.workerId, 'ticket_comment', `revision requested for ${next.identifier}`, { ticketId: t.id });
    if (TERMINAL.has(to)) propagateTerminal(next, actor);
    return next;
  }

  // ---------- service ----------

  const service: TicketsService = {
    create(actor, input: TicketCreateInput) {
      if (input.projectId) {
        // Accept a project slug as well as its id.
        let resolved: string | null = null;
        try { resolved = deps().projects.get(input.projectId).id; } catch { resolved = project(input.projectId) ? input.projectId : null; }
        if (!resolved) throw new OcError('not_found', `project ${input.projectId} not found`);
        input = { ...input, projectId: resolved };
      }
      if (input.parentId && !find(input.parentId)) throw new OcError('not_found', `parent ticket ${input.parentId} not found`);
      const blockedBy = input.blockedBy ?? [];
      for (const b of blockedBy) if (!find(b)) throw new OcError('not_found', `blocker ${b} not found`);
      if (input.assigneeRoleId && !db.get('SELECT id FROM roles WHERE id = ?', [input.assigneeRoleId])) {
        throw new OcError('not_found', `role ${input.assigneeRoleId} not found`);
      }
      return tx(db, () => {
        const number = allocateNumber();
        const identifier = `${prefix()}-${number}`;
        const id = newId();
        const now = nowIso();
        const openBlockers = blockedBy.filter((b) => get(b).status !== 'done');
        const status: TicketStatus = openBlockers.length ? 'blocked' : input.assigneeRoleId ? 'todo' : 'backlog';
        try {
          db.insert('tickets', {
            id, workspaceId: ws, projectId: input.projectId ?? null, number, identifier, kind: input.kind, title: input.title,
            description: input.description ?? '', status, priority: input.priority ?? 'medium', autoMerge: input.autoMerge ?? false,
            assigneeRoleId: input.assigneeRoleId ?? null, assigneeHuman: false, parentId: input.parentId ?? null,
            createdByKind: actor.kind, createdById: actor.id, originKind: input.originKind ?? null,
            originFingerprint: input.originFingerprint ?? null, blockedTransitionAt: openBlockers.length ? now : null,
            createdAt: now, updatedAt: now,
          });
        } catch (e) {
          if (input.originFingerprint && /UNIQUE/i.test(String(e))) {
            throw new OcError('conflict', 'an open ticket with the same origin fingerprint already exists', { originFingerprint: input.originFingerprint });
          }
          throw e;
        }
        for (const b of blockedBy) {
          assertNoCycle(id, [b]);
          db.insert('ticket_relations', { ticketId: id, relatedTicketId: b, kind: 'blocks' });
        }
        const t = get(id);
        if (input.assigneeRoleId) bindOpenspec(t);
        const created = get(id);
        recordActivity(db, ws, actor, 'ticket.create', 'ticket', id, { kind: input.kind, identifier, status }, id);
        ctx.events.emit('ticket.created', 'ticket', id, created);
        return created;
      });
    },

    get,

    list(filter: TicketFilter = {}) {
      const where: string[] = ['workspace_id = ?'];
      const params: Array<string | number> = [ws];
      if (filter.projectId) { where.push('project_id = ?'); params.push(filter.projectId); }
      if (filter.roleId) { where.push('assignee_role_id = ?'); params.push(filter.roleId); }
      if (filter.workerId) { where.push('worker_id = ?'); params.push(filter.workerId); }
      if (filter.status?.length) { where.push(`status IN (${filter.status.map(() => '?').join(',')})`); params.push(...filter.status); }
      else if (!filter.includeTerminal) { where.push("status NOT IN ('done','cancelled')"); }
      if (filter.kind?.length) { where.push(`kind IN (${filter.kind.map(() => '?').join(',')})`); params.push(...filter.kind); }
      if (filter.search) { where.push('(title LIKE ? OR description LIKE ? OR identifier LIKE ?)'); const q = `%${filter.search}%`; params.push(q, q, q.toUpperCase()); }
      const clause = where.join(' AND ');
      const total = db.get<{ n: number }>(`SELECT COUNT(*) n FROM tickets WHERE ${clause}`, params)?.n ?? 0;
      const limit = Math.min(filter.limit ?? 100, 500);
      const offset = filter.offset ?? 0;
      const items = db.all<Record<string, unknown>>(`SELECT * FROM tickets WHERE ${clause} ORDER BY number DESC LIMIT ? OFFSET ?`, [...params, limit, offset]).map(row);
      return { items, total } satisfies Page<Ticket>;
    },

    update(actor, id, patch) {
      const t = get(id);
      const clean: Record<string, unknown> = {};
      for (const k of ['title', 'description', 'priority', 'autoMerge', 'parentId', 'projectId'] as const) {
        if (patch[k] !== undefined) clean[k] = patch[k];
      }
      if (!Object.keys(clean).length) return t;
      if (clean.parentId && clean.parentId === t.id) throw new OcError('validation', 'a ticket cannot be its own parent');
      return tx(db, () => {
        const next = touch(t.id, clean);
        recordActivity(db, ws, actor, 'ticket.update', 'ticket', t.id, { keys: Object.keys(clean) }, t.id);
        ctx.events.emit('ticket.updated', 'ticket', t.id, next);
        return next;
      });
    },

    assign(actor, id, roleId) {
      const t = get(id);
      if (roleId) {
        const role = db.get<{ id: string; projectId: string; status: string }>('SELECT id, project_id, status FROM roles WHERE id = ?', [roleId]);
        if (!role) throw new OcError('not_found', `role ${roleId} not found`);
        if (role.status === 'retired') throw new OcError('validation', 'cannot assign a retired role');
        if (t.projectId && role.projectId !== t.projectId) throw new OcError('validation', 'role belongs to a different project', { roleId, projectId: t.projectId });
      }
      return tx(db, () => {
        const patch: Record<string, unknown> = { assigneeRoleId: roleId, assigneeHuman: false };
        if (roleId && t.status === 'backlog') patch.status = 'todo';
        if (!roleId) patch.workerId = null;
        const next = touch(t.id, patch);
        if (roleId) bindOpenspec(next);
        const out = get(t.id);
        recordActivity(db, ws, actor, 'ticket.assign', 'ticket', t.id, { roleId, status: out.status }, t.id);
        ctx.events.emit('ticket.assigned', 'ticket', t.id, out);
        if (patch.status === 'todo') ctx.events.emit('ticket.status', 'ticket', t.id, out);
        return out;
      });
    },

    setBlockers(actor, id, blockedBy) {
      const t = get(id);
      for (const b of blockedBy) if (!find(b)) throw new OcError('not_found', `blocker ${b} not found`);
      assertNoCycle(t.id, blockedBy);
      return tx(db, () => {
        db.run('DELETE FROM ticket_relations WHERE ticket_id = ? AND kind = ?', [t.id, 'blocks']);
        for (const b of blockedBy) db.insert('ticket_relations', { ticketId: t.id, relatedTicketId: b, kind: 'blocks' });
        const open = blockersOf(t.id).filter((b) => b.status !== 'done');
        const patch: Record<string, unknown> = {};
        if (open.length && !TERMINAL.has(t.status) && t.status !== 'blocked') {
          patch.status = 'blocked';
          patch.blockedTransitionAt = nowIso();
        } else if (!open.length && t.status === 'blocked') {
          patch.status = t.assigneeRoleId || t.workerId ? 'todo' : 'backlog';
          patch.unblockJson = null;
          patch.blockedTransitionAt = null;
        }
        const next = touch(t.id, patch);
        recordActivity(db, ws, actor, 'ticket.blockers', 'ticket', t.id, { blockedBy, status: next.status }, t.id);
        ctx.events.emit('ticket.updated', 'ticket', t.id, next);
        if (patch.status) {
          ctx.events.emit('ticket.status', 'ticket', t.id, next);
          if (patch.status !== 'blocked') wake(next.workerId, 'blockers_resolved', `blockers cleared for ${next.identifier}`, { ticketId: t.id });
        }
        return next;
      });
    },

    blockers: (id) => blockersOf(get(id).id),
    children: (id) => childrenOf(get(id).id),

    checkout(actor, id, runId, agentId) {
      const t = get(id);
      if (t.workerId && t.workerId !== agentId) {
        throw new OcError('conflict', `${t.identifier} is checked out by another worker`, { workerId: t.workerId });
      }
      if (t.executionRunId && t.executionRunId !== runId) {
        const holder = db.get<{ agentId: string }>('SELECT agent_id FROM runs WHERE id = ?', [t.executionRunId]);
        if (holder && holder.agentId !== agentId) {
          throw new OcError('conflict', `${t.identifier} is locked by run ${t.executionRunId}`, { runId: t.executionRunId, agentId: holder.agentId });
        }
      }
      return tx(db, () => {
        const next = touch(t.id, { checkoutRunId: runId, executionRunId: runId, executionLockedAt: nowIso() });
        recordActivity(db, ws, actor, 'ticket.checkout', 'ticket', t.id, { runId, agentId }, t.id);
        ctx.events.emit('ticket.updated', 'ticket', t.id, next);
        return next;
      });
    },

    release(actor, id, runId, note) {
      const t = get(id);
      return tx(db, () => {
        const patch: Record<string, unknown> = {};
        if (t.executionRunId === runId) { patch.executionRunId = null; patch.executionLockedAt = null; }
        if (t.checkoutRunId === runId) patch.checkoutRunId = null;
        const next = touch(t.id, patch);
        if (note) systemComment(t.id, note, actor);
        recordActivity(db, ws, actor, 'ticket.release', 'ticket', t.id, { runId, note: note ?? null }, t.id);
        ctx.events.emit('ticket.updated', 'ticket', t.id, next);
        return next;
      });
    },

    transition,

    cancel(actor, id, reason) {
      const t = get(id);
      if (TERMINAL.has(t.status)) throw new OcError('wrong_status', `${t.identifier} is already ${t.status}`);
      return tx(db, () => {
        const next = touch(t.id, { status: 'cancelled', cancelledAt: nowIso(), unblockJson: null });
        systemComment(t.id, `Cancelled: ${reason}`, actor);
        recordActivity(db, ws, actor, 'ticket.cancel', 'ticket', t.id, { from: t.status, reason }, t.id);
        ctx.events.emit('ticket.status', 'ticket', t.id, next);
        propagateTerminal(next, actor);
        return next;
      });
    },

    comment(actor, id, body, kind: CommentKind = 'comment', sourceTrust?: SourceTrust) {
      const t = get(id);
      const trust: SourceTrust = sourceTrust ?? (actor.kind === 'human' ? 'trusted' : actor.kind === 'agent' ? 'agent' : 'trusted');
      const c: TicketComment = {
        id: newId(), ticketId: t.id, authorKind: actor.kind, authorId: actor.id, runId: actor.runId ?? null,
        body, kind, sourceTrust: trust, createdAt: nowIso(),
      };
      return tx(db, () => {
        db.insert('ticket_comments', { ...c });
        recordActivity(db, ws, actor, 'ticket.comment', 'ticket_comment', c.id, { kind }, t.id);
        ctx.events.emit('ticket.comment', 'ticket', t.id, c);
        if (actor.kind === 'human' && t.workerId) {
          wake(t.workerId, 'ticket_comment', `new comment on ${t.identifier}`, { ticketId: t.id, commentId: c.id, body: body.slice(0, 500) });
        }
        return c;
      });
    },

    comments(id, after) {
      const t = get(id);
      const params: Array<string> = [t.id];
      let sql = 'SELECT * FROM ticket_comments WHERE ticket_id = ? AND deleted_at IS NULL';
      if (after) { sql += ' AND created_at > ?'; params.push(after); }
      sql += ' ORDER BY created_at, rowid';
      return db.all<TicketComment>(sql, params);
    },

    putDocument,

    getDocument(id, key, revision) {
      const t = get(id);
      const doc = db.get<{ id: string; currentRevision: number }>('SELECT id, current_revision FROM ticket_documents WHERE ticket_id = ? AND key = ?', [t.id, key]);
      if (!doc) return null;
      const rev = revision ?? doc.currentRevision;
      const r = db.get<{ body: string; createdAt: string }>('SELECT body, created_at FROM ticket_document_revisions WHERE document_id = ? AND revision = ?', [doc.id, rev]);
      if (!r) return null;
      return { documentId: doc.id, revision: rev, body: r.body, createdAt: r.createdAt };
    },

    documentRevisions(id, key) {
      const t = get(id);
      const doc = db.get<{ id: string }>('SELECT id FROM ticket_documents WHERE ticket_id = ? AND key = ?', [t.id, key]);
      if (!doc) return [];
      return db.all<{ revision: number; authorKind: string; createdAt: string }>(
        'SELECT revision, author_kind, created_at FROM ticket_document_revisions WHERE document_id = ? ORDER BY revision',
        [doc.id],
      );
    },

    addWorkProduct(actor, id, wp) {
      const t = get(id);
      const wpId = newId();
      const now = nowIso();
      return tx(db, () => {
        if (wp.isPrimary) db.run('UPDATE ticket_work_products SET is_primary = 0 WHERE ticket_id = ?', [t.id]);
        db.insert('ticket_work_products', {
          id: wpId, ticketId: t.id, runId: actor.runId ?? null, type: wp.type as WorkProductType, provider: wp.provider ?? null,
          externalId: wp.externalId ?? null, url: wp.url ?? null, title: wp.title ?? null, state: wp.state ?? null,
          isPrimary: wp.isPrimary ?? false, metadataJson: wp.metadata ?? {}, createdAt: now, updatedAt: now,
        });
        if (wp.type === 'pull_request' || wp.type === 'branch') {
          const delivery = { ...(t.delivery ?? {}), ...(wp.type === 'pull_request' ? { prUrl: wp.url, prState: wp.state } : { branch: wp.title ?? wp.externalId }) };
          db.update('tickets', t.id, { deliveryJson: delivery, updatedAt: now });
        }
        recordActivity(db, ws, actor, 'ticket.work_product', 'ticket_work_product', wpId, { type: wp.type, url: wp.url ?? null }, t.id);
        ctx.events.emit('ticket.work_product', 'ticket', t.id, { ticketId: t.id, id: wpId, ...wp });
        return { id: wpId };
      });
    },

    workProducts(id) {
      const t = get(id);
      return db.all<Record<string, unknown>>('SELECT * FROM ticket_work_products WHERE ticket_id = ? ORDER BY created_at', [t.id]);
    },

    async mergeDone(actor, id, info) {
      const t = get(id);
      if (t.status !== 'merging') throw new OcError('wrong_status', `${t.identifier} is ${t.status}, not merging`);
      // Land the delivery into the primary clone first (ff for local-branch; verify containment for pr). Not landed → the worker keeps the ticket in merging.
      let landInfo: LandResult | null = null;
      if (t.projectId) {
        let project: Project | null = null;
        try { project = deps().projects.get(t.projectId); } catch { project = null; }
        if (project && existsSync(project.clonePath)) {
          const wt = db.get<{ branch: string }>('SELECT branch FROM worktrees WHERE ticket_id = ? AND status != ? ORDER BY created_at DESC LIMIT 1', [t.id, 'removed']);
          const branch = wt?.branch ?? ticketBranchFor(t);
          landInfo = await landDelivery(ctx.config, project, t, branch);
          recordActivity(db, ws, actor, 'ticket.delivery_landed', 'ticket', t.id, { ...landInfo }, t.id);
        } else log.warn({ ticketId: t.id }, 'mergeDone: no project clone available; skipping delivery landing');
      }
      let archivedAs: string | null = null;
      let skipped: string | null = null;
      try {
        const res = await deps().openspec.archiveAfterMerge(t.id);
        archivedAs = res.archivedAs;
        skipped = res.skipped;
      } catch (e) {
        const action = `openspec archive failed: ${e instanceof Error ? e.message : String(e)}`;
        tx(db, () => {
          touch(t.id, { unblockJson: { owner: 'conductor', action } });
          systemComment(t.id, action, actor);
          recordActivity(db, ws, actor, 'ticket.merge_archive_failed', 'ticket', t.id, { error: action }, t.id);
          ctx.events.emit('ticket.updated', 'ticket', t.id, get(t.id));
        });
        wake(conductorId(), 'system', `openspec archive failed for ${t.identifier}`, { ticketId: t.id, error: action });
        throw new OcError('internal', action, { ticketId: t.id });
      }

      const next = tx(db, () => {
        if (info.mergeCommit) {
          db.insert('ticket_work_products', {
            id: newId(), ticketId: t.id, runId: actor.runId ?? null, type: 'commit', provider: 'git', externalId: info.mergeCommit,
            url: null, title: `merge ${info.mergeCommit.slice(0, 12)}`, state: 'merged', isPrimary: false,
            metadataJson: { method: info.method ?? null }, createdAt: nowIso(), updatedAt: nowIso(),
          });
        }
        const delivery = { ...(t.delivery ?? {}), merged: true, mergeCommit: info.mergeCommit ?? landInfo?.head ?? null, method: info.method ?? landInfo?.mode ?? null, archivedAs, landed: landInfo?.detail ?? null };
        const updated = touch(t.id, { status: 'done', completedAt: nowIso(), deliveryJson: delivery, unblockJson: null });
        recordActivity(db, ws, actor, 'ticket.merged', 'ticket', t.id, { mergeCommit: info.mergeCommit ?? null, archivedAs, skipped }, t.id);
        ctx.events.emit('ticket.merged', 'ticket', t.id, { ticketId: t.id, mergeCommit: info.mergeCommit ?? null, archivedAs, skipped });
        ctx.events.emit('ticket.status', 'ticket', t.id, updated);
        return updated;
      });
      propagateTerminal(next, actor);
      if (t.projectId) { const pid = t.projectId; setTimeout(() => { deps().specs.index(pid).catch((e) => log.debug({ err: String(e) }, 'spec reindex after merge failed')); }, 100).unref(); }
      log.info({ ticketId: t.id, archivedAs, skipped }, 'ticket merged');
      return next;
    },

    async autoMergeSweep(): Promise<number> {
      const rows = db.all<Record<string, unknown>>("SELECT * FROM tickets WHERE workspace_id = ? AND status = 'in_review' AND auto_merge = 1", [ws]).map((r) => ticketRow(r) as unknown as Ticket);
      let advanced = 0;
      for (const t of rows) {
        try {
          const project = t.projectId ? deps().projects.get(t.projectId) : null;
          const policies = (project?.policies ?? {}) as { deliveryMode?: string; requireCi?: boolean };
          const mode = policies.deliveryMode ?? ctx.config.defaults.deliveryMode;
          if (mode === 'pr' && policies.requireCi !== false && project) {
            const pr = db.get<{ url: string | null }>("SELECT url FROM ticket_work_products WHERE ticket_id = ? AND type = 'pull_request' ORDER BY created_at DESC LIMIT 1", [t.id]);
            const forge = ctx.registries.forges.get('github');
            if (pr?.url && forge) {
              const state = await forge.prState(project.clonePath, pr.url).catch(() => null);
              if (!state) continue;
              if (state.ciState === 'pending') continue;
              if (state.ciState === 'failure') { systemComment(t.id, 'auto-merge is waiting: CI is red on the PR', { kind: 'system', id: null }); continue; }
            }
          }
          await service.transition({ kind: 'system', id: null }, t.id, { to: 'merging', note: 'auto-merge: no approval required for this ticket' });
          advanced++;
        } catch (e) { log.warn({ ticket: t.identifier, err: String(e) }, 'auto-merge advance failed'); }
      }
      return advanced;
    },

    livenessViolations() {
      const candidates = db
        .all<Record<string, unknown>>(
          `SELECT * FROM tickets WHERE workspace_id = ? AND status IN (${LIVENESS_STATUSES.map(() => '?').join(',')})`,
          [ws, ...LIVENESS_STATUSES],
        )
        .map(row);
      return candidates.filter((t) => {
        if (t.assigneeHuman) return false;
        if (hasOpenDecision(t.id)) return false;
        if (t.monitorNextCheckAt) return false;
        const worker = db.get<{ id: string; status: string }>(
          "SELECT id, status FROM agents WHERE ticket_id = ? AND kind = 'worker' AND status NOT IN ('retired','done') ORDER BY created_at DESC LIMIT 1",
          [t.id],
        );
        if (!worker) return !t.assigneeRoleId; // no role at all ⇒ nothing will ever spawn; a role means a pending spawn
        const liveRun = db.get<{ n: number }>("SELECT COUNT(*) n FROM runs WHERE agent_id = ? AND status IN ('queued','running')", [worker.id])?.n ?? 0;
        const queuedWake = db.get<{ n: number }>("SELECT COUNT(*) n FROM wakeups WHERE agent_id = ? AND status IN ('queued','claimed')", [worker.id])?.n ?? 0;
        return liveRun === 0 && queuedWake === 0;
      });
    },

    nextIdentifier() {
      return `${prefix()}-${allocateNumber()}`;
    },
  };

  return service;
}
