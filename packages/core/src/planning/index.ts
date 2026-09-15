/**
 * A project's draft plan (VS-398): a captain-authored, pre-ticket planning session and its ordered
 * list of draft tickets. Data only — spawning the planning agent and creating the plan's chat thread
 * are `WorkersService`'s concern; this service owns `plans` and `plan_drafts` rows and nothing else.
 * See `openspec/changes/vs-398-captain-can-t-plan-a-large-feature-inter`.
 */
import { newId, nowIso } from '@weave-ai/db';
import { OcError, PLAN_DRAFT_KINDS, PLAN_DRAFT_TIERS, PLAN_TITLE_MAX_WORDS, TICKET_PRIORITIES, type Plan, type PlanDraft, type PlanDraftKind, type PlanDraftTier, type PlanSummary, type PlanTitleSource, type TicketPriority } from '@weave-ai/shared';
import type { Actor, CoreServices, PlanDraftInput, PlanDraftPatch, PlanningService } from '../api.js';
import type { WorkspaceContext } from '../context.js';
import { tx } from '../tickets/tx.js';

function isDraftKind(v: unknown): v is PlanDraftKind {
  return (PLAN_DRAFT_KINDS as readonly string[]).includes(String(v));
}
function isTier(v: unknown): v is PlanDraftTier {
  return (PLAN_DRAFT_TIERS as readonly string[]).includes(String(v));
}
function isPriority(v: unknown): v is TicketPriority {
  return (TICKET_PRIORITIES as readonly string[]).includes(String(v));
}

/** VS-477: a tab title is trimmed, whitespace-collapsed and stripped of wrapping quotes; an auto title is capped at six words. */
function normalisePlanTitle(raw: string, source: PlanTitleSource): string {
  let t = raw.trim().replace(/\s+/g, ' ').replace(/^["'`]+|["'`]+$/g, '').trim();
  if (source === 'auto') t = t.split(' ').slice(0, PLAN_TITLE_MAX_WORDS).join(' ');
  return t.slice(0, 80).trim();
}

export function createPlanningService(ctx: WorkspaceContext, deps: () => CoreServices): PlanningService {
  const db = ctx.db;
  const ws = ctx.workspaceId;

  const asPlan = (row: Omit<Plan, 'workspaceId'>): Plan => ({ ...row, workspaceId: ws });

  const get = (planId: string): Plan => {
    const row = db.get<Omit<Plan, 'workspaceId'>>('SELECT * FROM plans WHERE id = ?', [planId]);
    if (!row) throw new OcError('not_found', `plan ${planId} not found`);
    return asPlan(row);
  };

  const getDraft = (draftId: string): PlanDraft => {
    const row = db.get<PlanDraft>('SELECT * FROM plan_drafts WHERE id = ?', [draftId]);
    if (!row) throw new OcError('not_found', `plan draft ${draftId} not found`);
    return row;
  };

  const resolveProject = (projectId: string): string => deps().projects.get(projectId).id;

  const requireDrafting = (plan: Plan): void => {
    if (plan.status !== 'drafting') throw new OcError('validation', `plan ${plan.id} is ${plan.status}, not drafting`, { planId: plan.id, status: plan.status });
  };

  const requireTitle = (title: string): string => {
    const trimmed = title.trim();
    if (!trimmed) throw new OcError('validation', 'title is required');
    return trimmed;
  };

  const requireRole = (roleId: string | null | undefined, projectId: string): string | null => {
    if (!roleId) return null;
    const role = deps().roles.get(roleId);
    if (role.projectId !== projectId) throw new OcError('not_found', `role ${roleId} is not in this project`);
    return role.id;
  };

  /** A plan's draft ids in listing order. */
  const orderedIds = (planId: string): string[] =>
    db.all<{ id: string }>('SELECT id FROM plan_drafts WHERE plan_id = ? ORDER BY position, created_at, id', [planId]).map((r) => r.id);

  const renumber = (ids: string[], now: string): void => {
    ids.forEach((id, i) => db.update('plan_drafts', id, { position: i, updatedAt: now }));
  };

  const withPlaced = (ids: string[], movedId: string, position: number): string[] => {
    const rest = ids.filter((id) => id !== movedId);
    rest.splice(Math.max(0, Math.min(Math.trunc(position), rest.length)), 0, movedId);
    return rest;
  };

  const nextPosition = (planId: string): number => {
    const row = db.get<{ n: number }>('SELECT COALESCE(MAX(position), -1) + 1 AS n FROM plan_drafts WHERE plan_id = ?', [planId]);
    return Number(row?.n ?? 0);
  };

  const draftBlockers = (draftId: string): string[] =>
    db.all<{ blocksOnDraftId: string }>('SELECT blocks_on_draft_id FROM plan_draft_blockers WHERE plan_draft_id = ?', [draftId]).map((r) => r.blocksOnDraftId);

  /** Reject a blocker graph cycle: `id` must not be reachable from any of `blockedBy` — same shape as `tickets.service.ts`'s `assertNoCycle`, over `plan_draft_blockers` instead of `ticket_relations`. */
  const assertNoCycle = (id: string, blockedBy: string[]): void => {
    const seen = new Set<string>();
    const stack = [...blockedBy];
    while (stack.length) {
      const cur = stack.pop()!;
      if (cur === id) throw new OcError('validation', 'blocker cycle: a draft cannot block itself, directly or transitively', { draftId: id });
      if (seen.has(cur)) continue;
      seen.add(cur);
      for (const b of draftBlockers(cur)) stack.push(b);
    }
  };

  const setBlockers = (draftId: string, blockedBy: string[] | undefined, planId: string): void => {
    if (blockedBy === undefined) return;
    const unique = [...new Set(blockedBy)];
    for (const b of unique) {
      if (b === draftId) throw new OcError('validation', 'a draft cannot block itself');
      const target = db.get<{ planId: string }>('SELECT plan_id FROM plan_drafts WHERE id = ?', [b]);
      if (!target || target.planId !== planId) throw new OcError('not_found', `draft ${b} is not in this plan`);
    }
    assertNoCycle(draftId, unique);
    db.run('DELETE FROM plan_draft_blockers WHERE plan_draft_id = ?', [draftId]);
    for (const b of unique) db.run('INSERT INTO plan_draft_blockers (plan_draft_id, blocks_on_draft_id) VALUES (?, ?)', [draftId, b]);
  };

  return {
    list(projectId) {
      const pid = resolveProject(projectId);
      return db.all<Omit<Plan, 'workspaceId'>>('SELECT * FROM plans WHERE project_id = ? ORDER BY created_at DESC, id', [pid]).map(asPlan);
    },

    get,

    getDrafting(projectId) {
      const pid = resolveProject(projectId);
      // VS-477: a project may hold several drafting plans; `start` resumes the most recently created.
      const row = db.get<Omit<Plan, 'workspaceId'>>(
        "SELECT * FROM plans WHERE project_id = ? AND status = 'drafting' ORDER BY created_at DESC, id DESC LIMIT 1", [pid]);
      return row ? asPlan(row) : null;
    },

    listDrafting(projectId) {
      const pid = resolveProject(projectId);
      return db.all<PlanSummary>(
        `SELECT p.id, p.project_id, p.title, p.title_source, p.status,
                (SELECT COUNT(*) FROM plan_drafts d WHERE d.plan_id = p.id) AS draft_count,
                p.created_at, p.updated_at
           FROM plans p
          WHERE p.project_id = ? AND p.status = 'drafting'
          ORDER BY p.created_at DESC, p.id DESC`, [pid]);
    },

    create(actor, projectId, input) {
      const pid = resolveProject(projectId);
      const now = nowIso();
      const id = newId();
      db.insert('plans', {
        id, workspaceId: ws, projectId: pid, threadId: input.threadId, title: input.title ?? null,
        // A title supplied at creation is captain's; a plan created without one is labelled by the planner later.
        titleSource: input.title ? 'human' : 'auto', status: 'drafting',
        createdByKind: actor.kind, createdById: actor.id ?? '', createdAt: now, updatedAt: now,
      });
      const plan = get(id);
      ctx.events.emit('plan.created', 'plan', id, { projectId: pid });
      return plan;
    },

    setTitle(actor, planId, title, source) {
      const plan = get(planId);
      requireDrafting(plan);
      if (source === 'auto' && plan.titleSource === 'human') {
        throw new OcError('validation', `plan ${planId} was renamed by captain; an auto title cannot replace it`, { planId });
      }
      const normalised = normalisePlanTitle(title, source);
      if (!normalised) throw new OcError('validation', 'title is required');
      db.update('plans', planId, { title: normalised, titleSource: source, updatedAt: nowIso() });
      const updated = get(planId);
      ctx.events.emit('plan.titled', 'plan', planId, { projectId: plan.projectId, source, by: actor.id });
      return updated;
    },

    setAgent(planId, agentId) {
      db.update('plans', planId, { agentId, updatedAt: nowIso() });
      return get(planId);
    },

    discard(actor, planId) {
      const plan = get(planId);
      requireDrafting(plan);
      db.update('plans', planId, { status: 'discarded', discardedAt: nowIso(), updatedAt: nowIso() });
      const updated = get(planId);
      ctx.events.emit('plan.discarded', 'plan', planId, { projectId: plan.projectId, by: actor.id });
      return updated;
    },

    submit(actor, planId) {
      const plan = get(planId);
      requireDrafting(plan);
      db.update('plans', planId, { status: 'submitted', submittedAt: nowIso(), updatedAt: nowIso() });
      const updated = get(planId);
      ctx.events.emit('plan.submitted', 'plan', planId, { projectId: plan.projectId, by: actor.id });
      return updated;
    },

    listDrafts(planId) {
      get(planId); // 404s a missing plan
      return db.all<PlanDraft>('SELECT * FROM plan_drafts WHERE plan_id = ? ORDER BY position, created_at, id', [planId]);
    },

    getDraft,

    draftBlockers,

    creationOrder(planId) {
      const drafts = db.all<PlanDraft>('SELECT * FROM plan_drafts WHERE plan_id = ? ORDER BY position, created_at, id', [planId]);
      const blockersOf = new Map(drafts.map((d) => [d.id, new Set(draftBlockers(d.id))]));
      const done = new Set<string>();
      const order: string[] = [];
      const remaining = [...drafts];
      while (remaining.length) {
        const idx = remaining.findIndex((d) => [...blockersOf.get(d.id)!].every((b) => done.has(b)));
        if (idx === -1) {
          // Cycles are rejected at write time (setBlockers -> assertNoCycle), so this is unreachable
          // in practice; refusing loudly beats silently truncating the order if it ever is.
          throw new OcError('internal', `plan ${planId} has an unresolvable dependency order`, { remaining: remaining.map((d) => d.id) });
        }
        const [next] = remaining.splice(idx, 1);
        done.add(next!.id);
        order.push(next!.id);
      }
      return order;
    },

    addDraft(actor, planId, input: PlanDraftInput) {
      const plan = get(planId);
      requireDrafting(plan);
      const title = requireTitle(input.title);
      if (!isDraftKind(input.kind)) throw new OcError('validation', `kind must be ${PLAN_DRAFT_KINDS.join('|')}`);
      const priority = input.priority ?? 'medium';
      if (!isPriority(priority)) throw new OcError('validation', `priority must be ${TICKET_PRIORITIES.join('|')}`);
      if (!isTier(input.suggestedTier)) throw new OcError('validation', `suggestedTier must be ${PLAN_DRAFT_TIERS.join('|')}`);
      if (input.tierOverride !== undefined && input.tierOverride !== null && !isTier(input.tierOverride)) {
        throw new OcError('validation', `tierOverride must be ${PLAN_DRAFT_TIERS.join('|')}`);
      }
      const targetRoleId = requireRole(input.targetRoleId, plan.projectId);
      const now = nowIso();
      const id = newId();
      tx(db, () => {
        db.insert('plan_drafts', {
          id, planId, position: nextPosition(planId), title, description: input.description ?? '',
          kind: input.kind, priority, targetRoleId, suggestedTier: input.suggestedTier,
          tierOverride: input.tierOverride ?? null, status: 'pending', createdAt: now, updatedAt: now,
        });
        setBlockers(id, input.blockedBy, planId);
      });
      const draft = getDraft(id);
      ctx.events.emit('plan.draft_added', 'plan_draft', id, { planId });
      return draft;
    },

    updateDraft(actor, draftId, patch: PlanDraftPatch) {
      const current = getDraft(draftId);
      const plan = get(current.planId);
      requireDrafting(plan);
      const fields: Record<string, unknown> = {};
      if (patch.title !== undefined) fields.title = requireTitle(patch.title);
      if (patch.description !== undefined) fields.description = patch.description;
      if (patch.kind !== undefined) {
        if (!isDraftKind(patch.kind)) throw new OcError('validation', `kind must be ${PLAN_DRAFT_KINDS.join('|')}`);
        fields.kind = patch.kind;
      }
      if (patch.priority !== undefined) {
        if (!isPriority(patch.priority)) throw new OcError('validation', `priority must be ${TICKET_PRIORITIES.join('|')}`);
        fields.priority = patch.priority;
      }
      if (patch.targetRoleId !== undefined) fields.targetRoleId = requireRole(patch.targetRoleId, plan.projectId);
      if (patch.suggestedTier !== undefined) {
        if (!isTier(patch.suggestedTier)) throw new OcError('validation', `suggestedTier must be ${PLAN_DRAFT_TIERS.join('|')}`);
        fields.suggestedTier = patch.suggestedTier;
      }
      if (patch.tierOverride !== undefined) {
        if (patch.tierOverride !== null && !isTier(patch.tierOverride)) throw new OcError('validation', `tierOverride must be ${PLAN_DRAFT_TIERS.join('|')}`);
        fields.tierOverride = patch.tierOverride;
      }
      const now = nowIso();
      tx(db, () => {
        if (Object.keys(fields).length) db.update('plan_drafts', draftId, { ...fields, updatedAt: now });
        if (patch.blockedBy !== undefined) setBlockers(draftId, patch.blockedBy, current.planId);
        if (patch.position !== undefined) renumber(withPlaced(orderedIds(current.planId), draftId, patch.position), now);
      });
      const draft = getDraft(draftId);
      ctx.events.emit('plan.draft_updated', 'plan_draft', draftId, { planId: current.planId });
      return draft;
    },

    removeDraft(actor, draftId) {
      const current = getDraft(draftId);
      const plan = get(current.planId);
      requireDrafting(plan);
      tx(db, () => {
        db.run('DELETE FROM plan_drafts WHERE id = ?', [draftId]);
        renumber(orderedIds(current.planId), nowIso());
      });
      ctx.events.emit('plan.draft_removed', 'plan_draft', draftId, { planId: current.planId });
    },

    linkDraft(draftId, outcome) {
      const current = getDraft(draftId);
      const now = nowIso();
      if ('ticketId' in outcome) db.update('plan_drafts', draftId, { status: 'created', createdTicketId: outcome.ticketId, failureReason: null, updatedAt: now });
      else db.update('plan_drafts', draftId, { status: 'failed', failureReason: outcome.failureReason, updatedAt: now });
      const draft = getDraft(draftId);
      ctx.events.emit('plan.draft_linked', 'plan_draft', draftId, { planId: current.planId });
      return draft;
    },
  };
}
