/**
 * The `weave_plan_*` tools (VS-398) — exercised through `runTool`, the same entry the MCP endpoint
 * and the agent route use, over the harness's real planning service and sqlite db.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { Plan, PlanDraft, ToolResult } from '@weave-ai/shared';
import { runTool, type ToolCtx } from '../src/tools.js';
import type { RunTokenClaims } from '../src/runtoken.js';
import { makeHarness, type Harness } from './fakes.js';

let harness: Harness | null = null;
afterEach(async () => { await harness?.close(); harness = null; });

const WORKER: RunTokenClaims = { workspaceId: 'ws1', runId: 'run_1', agentId: 'ag_1', agentKind: 'worker', projectId: 'proj1', ticketId: 'tk_1', planId: null, roleId: 'role_1' };
const WEAVER: RunTokenClaims = { workspaceId: 'ws1', runId: 'run_c', agentId: 'ag_conductor', agentKind: 'weaver', projectId: null, ticketId: null, planId: null, roleId: null };
const planner = (planId: string): RunTokenClaims => ({ workspaceId: 'ws1', runId: 'run_p', agentId: 'ag_planner', agentKind: 'planner', projectId: null, ticketId: null, planId, roleId: null });

function seed(h: Harness): void {
  h.db.run("INSERT INTO projects (id, workspace_id, slug, name, git_url, default_branch, clone_path, max_workers, worktree_provider, openspec_enabled, policies_json, status, created_at, updated_at) VALUES ('proj1','ws1','api','API','git@example.com:acme/api.git','main','/tmp',4,'git',1,'{}','ready','t0','t0')");
  h.db.run("INSERT INTO projects (id, workspace_id, slug, name, git_url, default_branch, clone_path, max_workers, worktree_provider, openspec_enabled, policies_json, status, created_at, updated_at) VALUES ('proj2','ws1','web','Web','git@example.com:acme/web.git','main','/tmp/web',4,'git',1,'{}','ready','t0','t0')");
  h.db.run("INSERT INTO channels (id, workspace_id, kind) VALUES ('c1','ws1','web')");
  h.db.run("INSERT INTO channel_threads (id, channel_id, agent_id, created_at) VALUES ('th1','c1','ag_planner','t0')");
}

/** Creates a drafting plan directly through the service — plan creation is an HTTP/spawn concern, not an agent tool. */
const startPlan = (h: Harness, projectId = 'proj1'): Plan =>
  h.runtime.services.planning.create({ kind: 'human', id: 'victor' }, projectId, { threadId: 'th1', title: 'Dark mode rollout' });

const ctxFor = (h: Harness, claims: RunTokenClaims): ToolCtx =>
  ({ ws: h.runtime, claims, actor: { kind: 'agent', id: claims.agentId, runId: claims.runId } });

const call = (h: Harness, name: string, input: unknown, claims: RunTokenClaims): Promise<ToolResult<never>> =>
  runTool(name, ctxFor(h, claims), input) as Promise<ToolResult<never>>;

const dataOf = <T>(r: ToolResult<never>): T => (r as { ok: true; data: T }).data;

describe('the weave_plan_* tools (VS-398)', () => {
  it('lets the planner add, edit, remove and reorder drafts in its own plan', async () => {
    const h = makeHarness(); harness = h; seed(h);
    const plan = startPlan(h);
    const claims = planner(plan.id);

    const added = await call(h, 'weave_plan_draft_add', { title: 'Add token plumbing', kind: 'change', suggestedTier: 'standard' }, claims);
    expect(added.ok).toBe(true);
    const draft = dataOf<PlanDraft>(added);
    expect(draft).toMatchObject({ planId: plan.id, title: 'Add token plumbing', status: 'pending', position: 0 });

    const updated = await call(h, 'weave_plan_draft_update', { draftId: draft.id, tierOverride: 'deep' }, claims);
    expect(updated.ok).toBe(true);
    expect(dataOf<PlanDraft>(updated).tierOverride).toBe('deep');

    const second = dataOf<PlanDraft>(await call(h, 'weave_plan_draft_add', { title: 'Second', kind: 'task', suggestedTier: 'quick' }, claims));
    const reordered = await call(h, 'weave_plan_draft_reorder', { draftId: second.id, position: 0 }, claims);
    expect(reordered.ok).toBe(true);

    const got = dataOf<{ plan: Plan; drafts: PlanDraft[]; creationOrder: string[] }>(await call(h, 'weave_plan_get', {}, claims));
    expect(got.drafts.map((d) => d.title)).toEqual(['Second', 'Add token plumbing']);
    expect(got.creationOrder.sort()).toEqual([draft.id, second.id].sort());

    const removed = await call(h, 'weave_plan_draft_remove', { draftId: draft.id }, claims);
    expect(removed.ok).toBe(true);
    const after = dataOf<{ plan: Plan; drafts: PlanDraft[] }>(await call(h, 'weave_plan_get', {}, claims));
    expect(after.drafts.map((d) => d.title)).toEqual(['Second']);
  });

  it('refuses a planner acting on a plan other than its own', async () => {
    const h = makeHarness(); harness = h; seed(h);
    const mine = startPlan(h, 'proj1');
    h.db.run("INSERT INTO channel_threads (id, channel_id, agent_id, created_at) VALUES ('th2','c1','ag_planner2','t0')");
    const theirs = h.runtime.services.planning.create({ kind: 'human', id: 'victor' }, 'proj2', { threadId: 'th2' });
    const myClaims = planner(mine.id);

    const foreignDraft = h.runtime.services.planning.addDraft({ kind: 'human', id: 'v' }, theirs.id, { title: 'Foreign', kind: 'change', suggestedTier: 'standard' });

    const getForeign = await call(h, 'weave_plan_get', { planId: theirs.id }, myClaims);
    expect(getForeign.ok).toBe(false);
    if (!getForeign.ok) expect(getForeign.error.code).toBe('forbidden');

    const updateForeign = await call(h, 'weave_plan_draft_update', { draftId: foreignDraft.id, title: 'Hijacked' }, myClaims);
    expect(updateForeign.ok).toBe(false);
    if (!updateForeign.ok) expect(updateForeign.error.code).toBe('forbidden');

    const removeForeign = await call(h, 'weave_plan_draft_remove', { draftId: foreignDraft.id }, myClaims);
    expect(removeForeign.ok).toBe(false);
    if (!removeForeign.ok) expect(removeForeign.error.code).toBe('forbidden');

    // The foreign draft is untouched.
    expect(h.runtime.services.planning.getDraft(foreignDraft.id).title).toBe('Foreign');
  });

  it('has no ticket-creation, worker-messaging, decision-answering or submit tool available to the planner', async () => {
    const h = makeHarness(); harness = h; seed(h);
    const plan = startPlan(h);
    const claims = planner(plan.id);
    for (const [name, input] of [
      ['weave_ticket_create', { kind: 'change', title: 'Sneaky' }],
      ['weave_worker_message', { workerId: 'w1', message: 'hi' }],
      ['weave_decision_answer', { id: 'd1', key: 'approve' }],
      ['weave_human_send', { body: 'hi' }],
      ['weave_plan_submit', { planId: plan.id }],
    ] as const) {
      const res = await call(h, name, input, claims);
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.error.code).toBe(name === 'weave_plan_submit' ? 'not_found' : 'forbidden');
    }
  });

  it('lets the weaver read any plan by id and link a draft to its created ticket, or to a failure reason', async () => {
    const h = makeHarness(); harness = h; seed(h);
    h.db.run("INSERT INTO tickets (id, workspace_id, project_id, number, identifier, kind, title, created_by_kind, created_at, updated_at) VALUES ('tkt-1','ws1','proj1',42,'ACME-42','change','Add token plumbing','agent','t0','t0')");
    const plan = startPlan(h);
    const draft = h.runtime.services.planning.addDraft({ kind: 'human', id: 'v' }, plan.id, { title: 'Add token plumbing', kind: 'change', suggestedTier: 'standard' });
    const failing = h.runtime.services.planning.addDraft({ kind: 'human', id: 'v' }, plan.id, { title: 'No role fits', kind: 'change', suggestedTier: 'standard' });

    const got = await call(h, 'weave_plan_get', { planId: plan.id }, WEAVER);
    expect(got.ok).toBe(true);
    expect(dataOf<{ plan: Plan }>(got).plan.id).toBe(plan.id);

    const linked = await call(h, 'weave_plan_draft_link', { draftId: draft.id, ticketId: 'tkt-1' }, WEAVER);
    expect(linked.ok).toBe(true);
    expect(dataOf<PlanDraft>(linked)).toMatchObject({ status: 'created', createdTicketId: 'tkt-1' });

    const failed = await call(h, 'weave_plan_draft_link', { draftId: failing.id, failureReason: 'no role fits' }, WEAVER);
    expect(failed.ok).toBe(true);
    expect(dataOf<PlanDraft>(failed)).toMatchObject({ status: 'failed', failureReason: 'no role fits' });

    // The weaver has no path to add, edit, remove or reorder a draft — only the planner does.
    for (const [name, input] of [
      ['weave_plan_draft_add', { title: 'x', kind: 'change', suggestedTier: 'standard' }],
      ['weave_plan_draft_update', { draftId: draft.id, title: 'x' }],
      ['weave_plan_draft_remove', { draftId: draft.id }],
      ['weave_plan_draft_reorder', { draftId: draft.id, position: 0 }],
    ] as const) {
      const res = await call(h, name, input, WEAVER);
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.error.code).toBe('forbidden');
    }
  });

  it('refuses a worker every weave_plan_* tool', async () => {
    const h = makeHarness(); harness = h; seed(h);
    const plan = startPlan(h);
    for (const [name, input] of [
      ['weave_plan_get', { planId: plan.id }],
      ['weave_plan_draft_add', { title: 'x', kind: 'change', suggestedTier: 'standard' }],
      ['weave_plan_draft_link', { draftId: 'd1', ticketId: 't1' }],
    ] as const) {
      const res = await call(h, name, input, WORKER);
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.error.code).toBe('forbidden');
    }
  });
});
