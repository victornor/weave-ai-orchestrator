import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { OcError } from '@weave-ai/shared';
import { makeHarness, type TestHarness } from '../testing/context.js';
import { createPlanningService } from './index.js';
import type { Actor, PlanningService, TicketCreateInput } from '../api.js';

const HUMAN: Actor = { kind: 'human', id: 'victor' };
const OTHER_PROJECT = 'p-other';
const OTHER_ROLE = 'r-other';

describe('planning (VS-398)', () => {
  let h: TestHarness;
  let planning: PlanningService;

  beforeEach(() => {
    h = makeHarness();
    h.ctx.db.insert('projects', {
      id: OTHER_PROJECT, workspaceId: h.workspaceId, slug: 'other', name: 'Other', gitUrl: 'git@example.com:acme/other.git',
      defaultBranch: 'main', clonePath: '/tmp/other', maxWorkers: 4, worktreeProvider: 'git', openspecEnabled: 1,
      policiesJson: {}, status: 'ready', createdAt: 't0', updatedAt: 't0',
    });
    h.ctx.db.insert('roles', {
      id: OTHER_ROLE, workspaceId: h.workspaceId, projectId: OTHER_PROJECT, slug: 'other-role', name: 'Other Role',
      charterSummary: 'c', scopeText: 's', sessionPolicy: 'per_ticket', maxWorkers: 2, status: 'active',
      specRevision: 1, createdBy: 'weaver', createdAt: 't0', updatedAt: 't0',
    });
    h.ctx.db.insert('channels', { id: 'c1', workspaceId: h.workspaceId, kind: 'web' });
    h.ctx.db.insert('channel_threads', { id: 'th1', channelId: 'c1', agentId: 'a-planner', createdAt: 't0' });
    h.ctx.db.insert('tickets', { id: 'tkt-1', workspaceId: h.workspaceId, projectId: h.projectId, number: 1, identifier: 'TST-1', kind: 'change', title: 'Add token plumbing', createdByKind: 'human', createdAt: 't0', updatedAt: 't0' });
    h.ctx.db.insert('agents', {
      id: 'agent-1', workspaceId: h.workspaceId, kind: 'planner', name: 'Planner', runtimeId: 'claude',
      homePath: '/tmp/planner-1', createdAt: 't0', updatedAt: 't0',
    });
    h.services.projects = {
      get: (id: string) => {
        if (id === h.projectId || id === h.projectSlug) return { id: h.projectId } as never;
        if (id === OTHER_PROJECT) return { id: OTHER_PROJECT } as never;
        throw new OcError('not_found', `project ${id} not found`);
      },
      list: () => [],
    } as never;
    h.services.roles = {
      get: (id: string) => {
        if (id === h.roleId) return { id: h.roleId, projectId: h.projectId } as never;
        if (id === OTHER_ROLE) return { id: OTHER_ROLE, projectId: OTHER_PROJECT } as never;
        throw new OcError('not_found', `role ${id} not found`);
      },
    } as never;
    planning = createPlanningService(h.ctx, h.deps);
    h.services.planning = planning;
  });
  afterEach(() => h.cleanup());

  const startPlan = (projectId = h.projectId) => planning.create(HUMAN, projectId, { threadId: 'th1', title: 'Dark mode rollout' });

  const addDraft = (planId: string, over: Partial<Parameters<PlanningService['addDraft']>[2]> = {}) =>
    planning.addDraft(HUMAN, planId, { title: 'Add token plumbing', kind: 'change', suggestedTier: 'standard', ...over });

  it('allows several drafting plans at once and resumes the most recent (VS-477)', () => {
    const first = startPlan();
    expect(first.status).toBe('drafting');
    expect(first.projectId).toBe(h.projectId);
    expect(first.createdByKind).toBe('human');
    expect(first.createdById).toBe('victor');
    expect(first.titleSource).toBe('human');
    const second = startPlan();
    expect(second.id).not.toBe(first.id);
    expect(planning.getDrafting(h.projectId)?.id).toBe(second.id);
    // Summaries are newest first, and count each plan's own drafts.
    addDraft(second.id, { title: 'B' });
    addDraft(first.id, { title: 'A1' });
    addDraft(first.id, { title: 'A2' });
    expect(planning.listDrafting(h.projectId).map((p) => [p.id, p.draftCount])).toEqual([[second.id, 1], [first.id, 2]]);
  });

  it('lists only drafting plans as tab summaries, newest first (VS-477)', () => {
    const first = startPlan();
    const second = startPlan();
    planning.submit(HUMAN, first.id);
    expect(planning.listDrafting(h.projectId).map((p) => p.id)).toEqual([second.id]);
    expect(planning.list(h.projectId).map((p) => p.id).sort()).toEqual([first.id, second.id].sort());
  });

  it('sets, replaces and protects a plan title (VS-477)', () => {
    const plan = planning.create(HUMAN, h.projectId, { threadId: 'th1' });
    expect(plan.title).toBeNull();
    expect(plan.titleSource).toBe('auto');
    const titled = planning.setTitle(HUMAN, plan.id, '  "Dark mode rollout"  ', 'auto');
    expect(titled.title).toBe('Dark mode rollout');
    expect(titled.titleSource).toBe('auto');
    // An auto title may be replaced while it is still auto.
    expect(planning.setTitle(HUMAN, plan.id, 'Dark mode and theming', 'auto').title).toBe('Dark mode and theming');
    // An auto title is capped at six words, and an empty one is refused.
    expect(planning.setTitle(HUMAN, plan.id, 'one two three four five six seven eight', 'auto').title).toBe('one two three four five six');
    expect(() => planning.setTitle(HUMAN, plan.id, '   ', 'auto')).toThrow(/title is required/);
    // Captain's rename wins, and an auto title can never overwrite it.
    expect(planning.setTitle(HUMAN, plan.id, 'Captain owned', 'human').titleSource).toBe('human');
    expect(() => planning.setTitle(HUMAN, plan.id, 'auto again', 'auto')).toThrow(/renamed by captain/);
    expect(planning.get(plan.id).title).toBe('Captain owned');
  });

  it('allows a new drafting plan once the prior one is submitted or discarded', () => {
    const first = startPlan();
    planning.submit(HUMAN, first.id);
    const second = startPlan();
    expect(second.id).not.toBe(first.id);
    expect(planning.getDrafting(h.projectId)?.id).toBe(second.id);
    planning.discard(HUMAN, second.id);
    expect(planning.getDrafting(h.projectId)).toBeNull();
    expect(planning.list(h.projectId).map((p) => p.id).sort()).toEqual([first.id, second.id].sort());
  });

  it('keeps each project’s plans separate', () => {
    const mine = startPlan();
    const theirs = startPlan(OTHER_PROJECT);
    expect(planning.getDrafting(h.projectId)?.id).toBe(mine.id);
    expect(planning.getDrafting(OTHER_PROJECT)?.id).toBe(theirs.id);
  });

  it('adds a draft with defaults and appends it to the plan order', () => {
    const plan = startPlan();
    const a = addDraft(plan.id, { title: 'A' });
    const b = addDraft(plan.id, { title: 'B' });
    expect(a.position).toBe(0);
    expect(b.position).toBe(1);
    expect(a.priority).toBe('medium');
    expect(a.status).toBe('pending');
    expect(a.tierOverride).toBeNull();
    expect(a.createdTicketId).toBeNull();
    expect(planning.listDrafts(plan.id).map((d) => d.title)).toEqual(['A', 'B']);
  });

  it('rejects an unknown kind, priority or tier, and a role from another project', () => {
    const plan = startPlan();
    expect(() => addDraft(plan.id, { kind: 'question' as never })).toThrow(/kind must be/);
    expect(() => addDraft(plan.id, { priority: 'urgent' as never })).toThrow(/priority must be/);
    expect(() => addDraft(plan.id, { suggestedTier: 'fast' as never })).toThrow(/suggestedTier must be/);
    expect(() => addDraft(plan.id, { tierOverride: 'fast' as never })).toThrow(/tierOverride must be/);
    expect(() => addDraft(plan.id, { targetRoleId: OTHER_ROLE })).toThrow(/not in this project/);
    expect(addDraft(plan.id, { targetRoleId: h.roleId }).targetRoleId).toBe(h.roleId);
  });

  it('overrides the suggested tier and keeps both visible', () => {
    const plan = startPlan();
    const draft = addDraft(plan.id, { suggestedTier: 'standard', tierOverride: 'deep' });
    expect(draft.suggestedTier).toBe('standard');
    expect(draft.tierOverride).toBe('deep');
  });

  it('sets, reads back and rejects a cross-plan or self blocker, direct and transitive cycles', () => {
    const plan = startPlan();
    const a = addDraft(plan.id, { title: 'A' });
    const b = addDraft(plan.id, { title: 'B' });
    const c = addDraft(plan.id, { title: 'C' });
    planning.updateDraft(HUMAN, b.id, { blockedBy: [a.id] });
    expect(planning.draftBlockers(b.id)).toEqual([a.id]);

    expect(() => planning.updateDraft(HUMAN, a.id, { blockedBy: [a.id] })).toThrow(/cannot block itself/);
    expect(() => planning.updateDraft(HUMAN, a.id, { blockedBy: [b.id] })).toThrow(/cycle/);
    planning.updateDraft(HUMAN, c.id, { blockedBy: [b.id] });
    expect(() => planning.updateDraft(HUMAN, a.id, { blockedBy: [c.id] })).toThrow(/cycle/);

    const otherPlan = startPlan(OTHER_PROJECT);
    const foreign = addDraft(otherPlan.id, { title: 'Foreign' });
    expect(() => planning.updateDraft(HUMAN, a.id, { blockedBy: [foreign.id] })).toThrow(/not in this plan/);
  });

  it('orders draft creation so every dependency comes before its dependents (VS-398)', () => {
    const plan = startPlan();
    const a = addDraft(plan.id, { title: 'A' });
    const b = addDraft(plan.id, { title: 'B' });
    const c = addDraft(plan.id, { title: 'C' });
    // Displayed order is A, B, C, but C depends on B and B depends on A — creation order must
    // still put a blocker before its dependent even though it already is, and must not silently
    // reorder drafts that have no relationship to each other.
    planning.updateDraft(HUMAN, b.id, { blockedBy: [a.id] });
    planning.updateDraft(HUMAN, c.id, { blockedBy: [b.id] });
    expect(planning.creationOrder(plan.id)).toEqual([a.id, b.id, c.id]);
  });

  it('creation order puts a later-displayed blocker before its earlier-displayed dependent', () => {
    const plan = startPlan();
    const first = addDraft(plan.id, { title: 'Displayed first' });
    const second = addDraft(plan.id, { title: 'Displayed second, but first depends on it' });
    planning.updateDraft(HUMAN, first.id, { blockedBy: [second.id] });
    const order = planning.creationOrder(plan.id);
    expect(order.indexOf(second.id)).toBeLessThan(order.indexOf(first.id));
  });

  it('reorders densely when a draft is moved, and clamps out-of-range positions', () => {
    const plan = startPlan();
    const a = addDraft(plan.id, { title: 'A' });
    addDraft(plan.id, { title: 'B' });
    const c = addDraft(plan.id, { title: 'C' });
    planning.updateDraft(HUMAN, c.id, { position: 0 });
    expect(planning.listDrafts(plan.id).map((d) => d.title)).toEqual(['C', 'A', 'B']);
    planning.updateDraft(HUMAN, c.id, { position: 99 });
    expect(planning.listDrafts(plan.id).map((d) => d.title)).toEqual(['A', 'B', 'C']);
    expect(planning.getDraft(a.id).position).toBe(0);
  });

  it('removes a draft, renumbers the rest, and clears its blockers', () => {
    const plan = startPlan();
    const a = addDraft(plan.id, { title: 'A' });
    const b = addDraft(plan.id, { title: 'B' });
    planning.updateDraft(HUMAN, b.id, { blockedBy: [a.id] });
    planning.removeDraft(HUMAN, a.id);
    expect(planning.listDrafts(plan.id).map((d) => d.id)).toEqual([b.id]);
    expect(planning.getDraft(b.id).position).toBe(0);
    expect(planning.draftBlockers(b.id)).toEqual([]);
  });

  it('freezes draft edits once the plan is submitted or discarded', () => {
    const plan = startPlan();
    const draft = addDraft(plan.id);
    planning.submit(HUMAN, plan.id);
    expect(() => addDraft(plan.id)).toThrow(/not drafting/);
    expect(() => planning.updateDraft(HUMAN, draft.id, { title: 'x' })).toThrow(/not drafting/);
    expect(() => planning.removeDraft(HUMAN, draft.id)).toThrow(/not drafting/);
    expect(() => planning.submit(HUMAN, plan.id)).toThrow(/not drafting/);
  });

  it('links a draft to its created ticket, or records a failure reason, without touching the other', () => {
    const plan = startPlan();
    const created = addDraft(plan.id, { title: 'Created' });
    const failed = addDraft(plan.id, { title: 'Failed' });
    const linked = planning.linkDraft(created.id, { ticketId: 'tkt-1' });
    expect(linked.status).toBe('created');
    expect(linked.createdTicketId).toBe('tkt-1');
    const failedDraft = planning.linkDraft(failed.id, { failureReason: 'no role fits' });
    expect(failedDraft.status).toBe('failed');
    expect(failedDraft.failureReason).toBe('no role fits');
    expect(planning.getDraft(created.id).status).toBe('created');
  });

  it('finds the draft (and plan) a ticket was linked from, or null for an unlinked ticket (VS-517)', () => {
    const plan = startPlan();
    const draft = addDraft(plan.id, { title: 'Scout it' });
    expect(planning.findDraftByTicket('tkt-1')).toBeNull();
    planning.linkDraft(draft.id, { ticketId: 'tkt-1' });
    expect(planning.findDraftByTicket('tkt-1')).toEqual({ draftId: draft.id, planId: plan.id });
  });

  it('reads a ticket plan origin, distinguishing an early dispatch from a submission-time ticket (VS-550)', () => {
    const insertTicket = (id: string, number: number, createdAt: string): void =>
      h.ctx.db.insert('tickets', { id, workspaceId: h.workspaceId, projectId: h.projectId, number, identifier: `TST-${id}`, kind: 'scout', title: id, createdByKind: 'human', createdAt, updatedAt: createdAt });
    const drafting = startPlan();
    const earlyDraft = addDraft(drafting.id, { title: 'Early scout', kind: 'scout' });
    insertTicket('tkt-early', 901, '2000-01-01T00:00:00.000Z');
    planning.linkDraft(earlyDraft.id, { ticketId: 'tkt-early' });

    const submitted = startPlan();
    const before = addDraft(submitted.id, { title: 'Dispatched before submit' });
    const after = addDraft(submitted.id, { title: 'Filed at submission' });
    insertTicket('tkt-before', 902, '2000-01-01T00:00:00.000Z');
    insertTicket('tkt-after', 903, '2999-01-01T00:00:00.000Z');
    planning.submit(HUMAN, submitted.id);
    planning.linkDraft(before.id, { ticketId: 'tkt-before' });
    planning.linkDraft(after.id, { ticketId: 'tkt-after' });

    expect(planning.planOriginForTicket('tkt-1')).toBeNull();
    expect(planning.planOriginForTicket('tkt-early')).toMatchObject({ planId: drafting.id, planStatus: 'drafting', dispatched: true });
    expect(planning.planOriginForTicket('tkt-before')).toMatchObject({ planId: submitted.id, planStatus: 'submitted', dispatched: true });
    expect(planning.planOriginForTicket('tkt-after')).toMatchObject({ planId: submitted.id, planStatus: 'submitted', dispatched: false });
    expect(planning.listPlanOrigins().map((o) => o.ticketId).sort()).toEqual(['tkt-after', 'tkt-before', 'tkt-early']);
  });

  describe('dispatchDraft (VS-517)', () => {
    const addScout = (planId: string, over: Partial<Parameters<PlanningService['addDraft']>[2]> = {}) =>
      planning.addDraft(HUMAN, planId, { title: 'Scout the auth flow', kind: 'scout', suggestedTier: 'quick', targetRoleId: h.roleId, ...over });

    beforeEach(() => {
      let n = 0;
      h.services.tickets = {
        create: (_actor: Actor, input: TicketCreateInput) => {
          n += 1;
          const id = `dispatched-tkt-${n}`;
          h.ctx.db.insert('tickets', {
            id, workspaceId: h.workspaceId, projectId: input.projectId ?? null, number: 900 + n, identifier: `TST-9${n}`,
            kind: input.kind, title: input.title, status: 'todo', priority: input.priority ?? 'medium',
            assigneeRoleId: input.assigneeRoleId ?? null, createdByKind: 'human', createdAt: 't0', updatedAt: 't0',
          });
          return { id, workspaceId: h.workspaceId, identifier: `TST-9${n}`, number: 900 + n, kind: input.kind, title: input.title, status: 'todo', priority: input.priority ?? 'medium', projectId: input.projectId ?? null, assigneeRoleId: input.assigneeRoleId ?? null } as never;
        },
      } as never;
    });

    it('dispatches a pending scout draft as a real ticket and links it immediately', () => {
      const plan = startPlan();
      const draft = addScout(plan.id);
      const linked = planning.dispatchDraft(HUMAN, draft.id);
      expect(linked.status).toBe('created');
      expect(linked.createdTicketId).toBe('dispatched-tkt-1');
    });

    it('refuses to dispatch a non-scout draft', () => {
      const plan = startPlan();
      const draft = addDraft(plan.id, { kind: 'change' });
      expect(() => planning.dispatchDraft(HUMAN, draft.id)).toThrow(/not a scout/);
    });

    it('refuses to dispatch a draft that is not in a drafting plan', () => {
      const plan = startPlan();
      const draft = addScout(plan.id);
      planning.submit(HUMAN, plan.id);
      expect(() => planning.dispatchDraft(HUMAN, draft.id)).toThrow(/not drafting/);
    });

    it('refuses to dispatch an already-dispatched draft a second time', () => {
      const plan = startPlan();
      const draft = addScout(plan.id);
      planning.dispatchDraft(HUMAN, draft.id);
      expect(() => planning.dispatchDraft(HUMAN, draft.id)).toThrow(/already created/);
    });

    it('refuses to dispatch a scout draft with no target role', () => {
      const plan = startPlan();
      const draft = addScout(plan.id, { targetRoleId: null });
      expect(() => planning.dispatchDraft(HUMAN, draft.id)).toThrow(/target role/);
    });
  });

  it('creation order skips an already-dispatched draft but still lets a dependent resolve through it (VS-517)', () => {
    const plan = startPlan();
    const scout = addDraft(plan.id, { title: 'Scout', kind: 'scout' });
    const dependent = addDraft(plan.id, { title: 'Depends on the scout' });
    planning.updateDraft(HUMAN, dependent.id, { blockedBy: [scout.id] });
    planning.linkDraft(scout.id, { ticketId: 'tkt-1' });
    expect(planning.creationOrder(plan.id)).toEqual([dependent.id]);
  });

  it('sets and clears the plan’s live agent', () => {
    const plan = startPlan();
    expect(plan.agentId).toBeNull();
    const withAgent = planning.setAgent(plan.id, 'agent-1');
    expect(withAgent.agentId).toBe('agent-1');
    expect(planning.setAgent(plan.id, null).agentId).toBeNull();
  });

  it('emits events for plan and draft lifecycle, carrying the plan id', async () => {
    const plan = startPlan();
    const draft = addDraft(plan.id);
    planning.updateDraft(HUMAN, draft.id, { title: 'x' });
    planning.linkDraft(draft.id, { ticketId: 'tkt-1' });
    const second = addDraft(startPlan(OTHER_PROJECT).id);
    planning.removeDraft(HUMAN, second.id);
    planning.submit(HUMAN, plan.id);
    await Promise.resolve();
    const mine = h.events.filter((e) => e.entityType === 'plan' || e.entityType === 'plan_draft');
    expect(mine.map((e) => e.type)).toEqual([
      'plan.created', 'plan.draft_added', 'plan.draft_updated', 'plan.draft_linked',
      'plan.created', 'plan.draft_added', 'plan.draft_removed', 'plan.submitted',
    ]);
  });
});
