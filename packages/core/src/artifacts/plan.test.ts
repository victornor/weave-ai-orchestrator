import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeHarness, type TestHarness } from '../testing/context.js';
import { createPlanArtifactsService } from './plan.js';
import type { Actor, PlanArtifactsService } from '../api.js';

const PLANNER: Actor = { kind: 'agent', id: 'planner-1', runId: 'run-1' };

/** A minimal plan row (plans → channel_threads → channels) so the service's FKs resolve. */
function seedPlan(h: TestHarness, id: string, threadId: string): void {
  let channel = h.db.get<{ id: string }>('SELECT id FROM channels WHERE workspace_id = ? AND kind = ?', [h.workspaceId, 'web']);
  if (!channel) {
    const cid = `c-${id}`;
    h.db.insert('channels', { id: cid, workspaceId: h.workspaceId, kind: 'web', configJson: {}, status: 'active' });
    channel = { id: cid };
  }
  h.db.insert('channel_threads', { id: threadId, channelId: channel.id, agentId: 'ag_planner', createdAt: 't0' });
  h.db.insert('plans', {
    id, workspaceId: h.workspaceId, projectId: h.projectId, threadId, title: null, titleSource: 'auto', status: 'drafting',
    createdByKind: 'human', createdById: 'v', createdAt: 't0', updatedAt: 't0',
  });
}

describe('plan artifacts (VS-622)', () => {
  let h: TestHarness;
  let artifacts: PlanArtifactsService;

  beforeEach(() => {
    h = makeHarness();
    artifacts = createPlanArtifactsService(h.ctx);
    seedPlan(h, 'plan_1', 'th_1');
    seedPlan(h, 'plan_2', 'th_2');
  });
  afterEach(() => h.cleanup());

  it('first publish under a new key returns revision 1 and no card yet', () => {
    const put = artifacts.put(PLANNER, 'plan_1', 'graph', '<html><body>hi</body></html>', { title: 'Graph' });
    expect(put).toEqual({ revision: 1, cardMessageId: null, created: true });
    expect(artifacts.getRevision('plan_1', 'graph')).toEqual({ body: '<html><body>hi</body></html>', revision: 1 });
  });

  it('republishing increments the revision, keeps exactly one artifact, and returns the recorded card', () => {
    artifacts.put(PLANNER, 'plan_1', 'graph', '<html><body>v1</body></html>');
    h.db.insert('thread_messages', { id: 'msg_1', threadId: 'th_1', direction: 'outbound', authorKind: 'agent', body: 'Artifact: graph', createdAt: 't0' });
    artifacts.setCardMessage('plan_1', 'graph', 'msg_1');
    const put = artifacts.put(PLANNER, 'plan_1', 'graph', '<html><body>v2</body></html>');
    expect(put).toEqual({ revision: 2, cardMessageId: 'msg_1', created: false });

    expect(artifacts.list('plan_1')).toHaveLength(1);
    expect(artifacts.getRevision('plan_1', 'graph', 1)).toEqual({ body: '<html><body>v1</body></html>', revision: 1 });
    expect(artifacts.getRevision('plan_1', 'graph')).toEqual({ body: '<html><body>v2</body></html>', revision: 2 });
  });

  it('isolates two plans, including the same key', () => {
    artifacts.put(PLANNER, 'plan_1', 'graph', '<html><body>one</body></html>');
    artifacts.put(PLANNER, 'plan_2', 'graph', '<html><body>two</body></html>');
    expect(artifacts.getRevision('plan_1', 'graph')?.body).toBe('<html><body>one</body></html>');
    expect(artifacts.getRevision('plan_2', 'graph')?.body).toBe('<html><body>two</body></html>');
    expect(artifacts.getRevision('plan_1', 'missing')).toBeNull();
  });

  it('lists artifacts most-recently-updated first and every revision oldest first', () => {
    artifacts.put(PLANNER, 'plan_1', 'first', '<html><body>a</body></html>', { title: 'First' });
    artifacts.put(PLANNER, 'plan_1', 'second', '<html><body>b</body></html>', { title: 'Second' });
    artifacts.put(PLANNER, 'plan_1', 'second', '<html><body>b2</body></html>', { title: 'Second' });
    const list = artifacts.list('plan_1');
    expect(list.map((a) => a.key)).toEqual(['second', 'first']);
    expect(list[0]).toMatchObject({ key: 'second', title: 'Second', revision: 2 });
    expect(artifacts.revisions('plan_1', 'second').map((r) => r.revision)).toEqual([1, 2]);
    expect(artifacts.revisions('plan_1', 'missing')).toEqual([]);
  });

  it('emits plan.artifact_published for the SSE/hook plumbing', async () => {
    artifacts.put(PLANNER, 'plan_1', 'graph', '<html><body>hi</body></html>');
    await Promise.resolve(); // EventBus.emit fires listeners on a microtask
    expect(h.events.some((e) => e.type === 'plan.artifact_published')).toBe(true);
  });
});
