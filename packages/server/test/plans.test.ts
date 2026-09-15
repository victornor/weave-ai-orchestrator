/** HTTP plan submit/discard (`/projects/:id/plans/:planId/submit|discard`) — session auth, project scoping, freeze-and-retire (VS-398 tasks 4.1/4.1a). */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Plan } from '@weave-ai/shared';
import { createApp } from '../src/app.js';
import { authed, makeHarness, type Harness } from './fakes.js';
import { createPlanningService } from '@weave-ai/core';

let harness: Harness | null = null;
afterEach(async () => { await harness?.close(); harness = null; });

function seed(h: Harness): void {
  h.db.run("INSERT INTO projects (id, workspace_id, slug, name, git_url, default_branch, clone_path, max_workers, worktree_provider, openspec_enabled, policies_json, status, created_at, updated_at) VALUES ('proj1','ws1','api','API','git@example.com:acme/api.git','main','/tmp',4,'git',1,'{}','ready','t0','t0')");
  h.db.run("INSERT INTO projects (id, workspace_id, slug, name, git_url, default_branch, clone_path, max_workers, worktree_provider, openspec_enabled, policies_json, status, created_at, updated_at) VALUES ('proj2','ws1','web','Web','git@example.com:acme/web.git','main','/tmp/web',4,'git',1,'{}','ready','t0','t0')");
  h.db.run("INSERT INTO channels (id, workspace_id, kind) VALUES ('c1','ws1','web')");
  h.db.run("INSERT INTO channel_threads (id, channel_id, agent_id, created_at) VALUES ('th1','c1','ag_conductor','t0')");
  h.runtime.services.planning = createPlanningService(h.runtime.ctx, () => h.runtime.services as never);
}

const startPlan = (h: Harness, projectId = 'proj1') => h.runtime.services.planning.create({ kind: 'human', id: 'victor' }, projectId, { threadId: 'th1', title: 'Redesign' });

describe('plan start/get/draft-patch/draft-remove HTTP (VS-398)', () => {
  it('POST start creates a plan and its agent via startOrResumePlan, returning a slim agent view', async () => {
    harness = makeHarness(); seed(harness);
    const plan = startPlan(harness);
    harness.runtime.services.workers = {
      ...harness.runtime.services.workers,
      startOrResumePlan: vi.fn(async () => ({ plan, agent: { id: 'ag_planner', status: 'active', runtimeId: 'claude' } })),
    } as never;
    const app = createApp(harness.deps);

    const res = await app.fetch(new Request('http://127.0.0.1/api/w/ws1/projects/proj1/plans/start', {
      method: 'POST', headers: authed({ 'content-type': 'application/json' }), body: JSON.stringify({ title: 'Redesign' }),
    }));
    expect(res.status).toBe(200);
    const started = await res.json() as { plan: Plan; agent: { id: string; status: string; runtimeId: string } };
    expect(started.plan.id).toBe(plan.id);
    expect(started.agent).toEqual({ id: 'ag_planner', status: 'active', runtimeId: 'claude' });
    expect(harness.runtime.services.workers.startOrResumePlan).toHaveBeenCalledWith(expect.objectContaining({ kind: 'human' }), 'proj1', { title: 'Redesign' });
  });

  it('GET reads a plan with its drafts, each carrying blockedBy', async () => {
    harness = makeHarness(); seed(harness);
    const plan = startPlan(harness);
    const a = harness.runtime.services.planning.addDraft({ kind: 'human', id: 'v' }, plan.id, { title: 'A', kind: 'change', suggestedTier: 'standard' });
    const b = harness.runtime.services.planning.addDraft({ kind: 'human', id: 'v' }, plan.id, { title: 'B', kind: 'task', suggestedTier: 'quick', blockedBy: [a.id] });
    const app = createApp(harness.deps);

    const res = await app.fetch(new Request(`http://127.0.0.1/api/w/ws1/projects/proj1/plans/${plan.id}`, { headers: authed() }));
    expect(res.status).toBe(200);
    const got = await res.json() as { plan: Plan; drafts: Array<{ id: string; blockedBy: string[] }> };
    expect(got.plan.id).toBe(plan.id);
    expect(got.drafts.find((d) => d.id === b.id)?.blockedBy).toEqual([a.id]);
  });

  it('PATCH edits a draft directly (captain’s own tier override), DELETE removes it', async () => {
    harness = makeHarness(); seed(harness);
    const plan = startPlan(harness);
    const draft = harness.runtime.services.planning.addDraft({ kind: 'human', id: 'v' }, plan.id, { title: 'A', kind: 'change', suggestedTier: 'standard' });
    const app = createApp(harness.deps);

    const patched = await app.fetch(new Request(`http://127.0.0.1/api/w/ws1/projects/proj1/plans/${plan.id}/drafts/${draft.id}`, {
      method: 'PATCH', headers: authed({ 'content-type': 'application/json' }), body: JSON.stringify({ tierOverride: 'deep' }),
    }));
    expect(patched.status).toBe(200);
    expect((await patched.json() as { tierOverride: string }).tierOverride).toBe('deep');

    const removed = await app.fetch(new Request(`http://127.0.0.1/api/w/ws1/projects/proj1/plans/${plan.id}/drafts/${draft.id}`, {
      method: 'DELETE', headers: authed(),
    }));
    expect(removed.status).toBe(200);
    expect(harness.runtime.services.planning.listDrafts(plan.id)).toHaveLength(0);
  });

  it('refuses a draft id that belongs to another plan', async () => {
    harness = makeHarness(); seed(harness);
    const mine = startPlan(harness, 'proj1');
    harness.db.insert('channel_threads', { id: 'th2', channelId: 'c1', agentId: 'ag_conductor', createdAt: 't0' });
    const theirs = harness.runtime.services.planning.create({ kind: 'human', id: 'victor' }, 'proj2', { threadId: 'th2' });
    const foreignDraft = harness.runtime.services.planning.addDraft({ kind: 'human', id: 'v' }, theirs.id, { title: 'Foreign', kind: 'change', suggestedTier: 'standard' });
    const app = createApp(harness.deps);

    const res = await app.fetch(new Request(`http://127.0.0.1/api/w/ws1/projects/proj1/plans/${mine.id}/drafts/${foreignDraft.id}`, {
      method: 'PATCH', headers: authed({ 'content-type': 'application/json' }), body: JSON.stringify({ title: 'x' }),
    }));
    expect(res.status).toBe(404);
  });
});

describe('plan submit/discard HTTP (VS-398)', () => {
  it('submits a plan, freezes further draft edits, retires the planner and wakes the weaver', async () => {
    harness = makeHarness(); seed(harness);
    const retireSpy = vi.fn(async () => {});
    harness.runtime.services.workers = { ...harness.runtime.services.workers, conductor: () => ({ id: 'ag_conductor', kind: 'weaver' }), retirePlanner: retireSpy } as never;
    const enqueueSpy = vi.fn((agentId: string, input: Record<string, unknown>) => ({ id: 'wk_1', agentId, ...input }));
    harness.runtime.services.wake = { ...harness.runtime.services.wake, enqueue: enqueueSpy } as never;
    const app = createApp(harness.deps);
    const plan = startPlan(harness);

    const res = await app.fetch(new Request(`http://127.0.0.1/api/w/ws1/projects/proj1/plans/${plan.id}/submit`, {
      method: 'POST', headers: authed(),
    }));
    expect(res.status).toBe(200);
    const submitted = await res.json() as Plan;
    expect(submitted.status).toBe('submitted');
    expect(submitted.submittedAt).toBeTruthy();

    expect(retireSpy).toHaveBeenCalledWith(plan.id);
    expect(enqueueSpy).toHaveBeenCalledWith('ag_conductor', expect.objectContaining({ source: 'plan_submitted', payload: { planId: plan.id } }));

    // A second submit is a no-op — the service throws, freezing drafts is already durable.
    const second = await app.fetch(new Request(`http://127.0.0.1/api/w/ws1/projects/proj1/plans/${plan.id}/submit`, { method: 'POST', headers: authed() }));
    expect(second.status).not.toBe(200);
    expect(retireSpy).toHaveBeenCalledTimes(1);

    const addAfterSubmit = () => harness!.runtime.services.planning.addDraft({ kind: 'human', id: 'victor' }, plan.id, { title: 'too late', kind: 'change', suggestedTier: 'standard' });
    expect(addAfterSubmit).toThrow(/not drafting/);
  });

  it('discards a plan and retires its planner, freeing the project for a new drafting plan', async () => {
    harness = makeHarness(); seed(harness);
    const retireSpy = vi.fn(async () => {});
    harness.runtime.services.workers = { ...harness.runtime.services.workers, retirePlanner: retireSpy } as never;
    const app = createApp(harness.deps);
    const plan = startPlan(harness);

    const res = await app.fetch(new Request(`http://127.0.0.1/api/w/ws1/projects/proj1/plans/${plan.id}/discard`, {
      method: 'POST', headers: authed(),
    }));
    expect(res.status).toBe(200);
    expect((await res.json() as Plan).status).toBe('discarded');
    expect(retireSpy).toHaveBeenCalledWith(plan.id);

    // Discarding freed the project up for a fresh drafting plan.
    expect(() => startPlan(harness!)).not.toThrow();
  });

  it('refuses a plan id that belongs to another project', async () => {
    harness = makeHarness(); seed(harness);
    harness.runtime.services.workers = { ...harness.runtime.services.workers, retirePlanner: vi.fn(async () => {}) } as never;
    const app = createApp(harness.deps);
    harness.db.insert('channel_threads', { id: 'th2', channelId: 'c1', agentId: 'ag_conductor', createdAt: 't0' });
    const plan = startPlan(harness, 'proj2');

    const res = await app.fetch(new Request(`http://127.0.0.1/api/w/ws1/projects/proj1/plans/${plan.id}/submit`, {
      method: 'POST', headers: authed(),
    }));
    expect(res.status).toBe(404);
  });

  it('refuses an unauthenticated request', async () => {
    harness = makeHarness(); seed(harness);
    const app = createApp(harness.deps);
    const plan = startPlan(harness);
    const res = await app.fetch(new Request(`http://127.0.0.1/api/w/ws1/projects/proj1/plans/${plan.id}/submit`, { method: 'POST' }));
    expect(res.status).toBe(401);
  });
});

describe('plan tab HTTP (VS-477)', () => {
  it('GET /plans lists drafting plans newest first with draft counts and title source', async () => {
    harness = makeHarness(); seed(harness);
    const first = startPlan(harness);
    harness.db.insert('channel_threads', { id: 'th2', channelId: 'c1', agentId: 'ag_conductor', createdAt: 't0' });
    const second = harness.runtime.services.planning.create({ kind: 'human', id: 'v' }, 'proj1', { threadId: 'th2' });
    harness.runtime.services.planning.addDraft({ kind: 'human', id: 'v' }, second.id, { title: 'B', kind: 'change', suggestedTier: 'standard' });
    const app = createApp(harness.deps);

    const res = await app.fetch(new Request('http://127.0.0.1/api/w/ws1/projects/proj1/plans?status=drafting', { headers: authed() }));
    expect(res.status).toBe(200);
    const body = await res.json() as { plans: Array<{ id: string; draftCount: number; titleSource: string }> };
    expect(body.plans.map((p) => p.id)).toEqual([second.id, first.id]);
    expect(body.plans[0]).toMatchObject({ draftCount: 1, titleSource: 'auto' });
    expect(body.plans[1]).toMatchObject({ titleSource: 'human' });
  });

  it('POST /plans creates an independent plan via workers.createPlan and returns 201', async () => {
    harness = makeHarness(); seed(harness);
    const plan = startPlan(harness);
    const createSpy = vi.fn(async () => ({ plan, agent: { id: 'ag_planner2', status: 'active', runtimeId: 'claude' } }));
    harness.runtime.services.workers = { ...harness.runtime.services.workers, createPlan: createSpy } as never;
    const app = createApp(harness.deps);

    const res = await app.fetch(new Request('http://127.0.0.1/api/w/ws1/projects/proj1/plans', {
      method: 'POST', headers: authed({ 'content-type': 'application/json' }), body: JSON.stringify({}),
    }));
    expect(res.status).toBe(201);
    expect((await res.json() as { agent: { id: string } }).agent.id).toBe('ag_planner2');
    expect(createSpy).toHaveBeenCalledWith(expect.objectContaining({ kind: 'human' }), 'proj1', { title: undefined });
  });

  it('PATCH /plans/:planId renames as human, and a later auto title cannot overwrite it', async () => {
    harness = makeHarness(); seed(harness);
    const plan = startPlan(harness);
    const app = createApp(harness.deps);

    const res = await app.fetch(new Request(`http://127.0.0.1/api/w/ws1/projects/proj1/plans/${plan.id}`, {
      method: 'PATCH', headers: authed({ 'content-type': 'application/json' }), body: JSON.stringify({ title: 'Captain title' }),
    }));
    expect(res.status).toBe(200);
    const renamed = await res.json() as Plan;
    expect(renamed.title).toBe('Captain title');
    expect(renamed.titleSource).toBe('human');
    expect(() => harness!.runtime.services.planning.setTitle({ kind: 'human', id: 'v' }, plan.id, 'auto title', 'auto')).toThrow(/renamed by captain/);
  });

  it('POST /plans/:planId/activate ensures the planner and sweeps idle siblings', async () => {
    harness = makeHarness(); seed(harness);
    const plan = startPlan(harness);
    const ensureSpy = vi.fn(async () => ({ id: 'ag_planner', status: 'active', runtimeId: 'claude' }));
    const sweepSpy = vi.fn(async () => 0);
    harness.runtime.services.workers = { ...harness.runtime.services.workers, ensurePlanner: ensureSpy, retireIdlePlanners: sweepSpy } as never;
    const app = createApp(harness.deps);

    const res = await app.fetch(new Request(`http://127.0.0.1/api/w/ws1/projects/proj1/plans/${plan.id}/activate`, { method: 'POST', headers: authed() }));
    expect(res.status).toBe(200);
    expect(ensureSpy).toHaveBeenCalledWith(expect.objectContaining({ kind: 'human' }), plan.id);
    expect(sweepSpy).toHaveBeenCalledWith('proj1', { keepPlanId: plan.id });
  });

  it('GET /plans rejects an unsupported status filter', async () => {
    harness = makeHarness(); seed(harness);
    const app = createApp(harness.deps);
    const res = await app.fetch(new Request('http://127.0.0.1/api/w/ws1/projects/proj1/plans?status=submitted', { headers: authed() }));
    expect(res.status).toBe(400);
  });
});
