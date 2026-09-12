import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeHarness, type TestHarness } from '../testing/context.js';
import { createWeaverArtifactsService } from './service.js';
import { createTicketsService } from '../tickets/service.js';
import type { Actor, WeaverArtifactsService } from '../api.js';

const WEAVER: Actor = { kind: 'agent', id: 'weaver-1', runId: 'run-1' };

describe('weaver artifacts', () => {
  let h: TestHarness;
  let artifacts: WeaverArtifactsService;

  beforeEach(() => {
    h = makeHarness();
    artifacts = createWeaverArtifactsService(h.ctx);
  });
  afterEach(() => h.cleanup());

  it('first publish under a new key returns revision 1', () => {
    const { revision } = artifacts.put(WEAVER, h.workspaceId, 'report', '<html><body>hi</body></html>', { title: 'Report' });
    expect(revision).toBe(1);
    expect(artifacts.getRevision(h.workspaceId, 'report')).toEqual({ body: '<html><body>hi</body></html>', revision: 1 });
  });

  it('republishing under the same key increments the revision and keeps the prior one readable', () => {
    artifacts.put(WEAVER, h.workspaceId, 'report', '<html><body>v1</body></html>');
    const { revision } = artifacts.put(WEAVER, h.workspaceId, 'report', '<html><body>v2</body></html>');
    expect(revision).toBe(2);

    expect(artifacts.list(h.workspaceId)).toHaveLength(1);
    expect(artifacts.getRevision(h.workspaceId, 'report')).toEqual({ body: '<html><body>v2</body></html>', revision: 2 });
    expect(artifacts.getRevision(h.workspaceId, 'report', 1)).toEqual({ body: '<html><body>v1</body></html>', revision: 1 });
  });

  it('lists artifacts most-recently-updated first', () => {
    artifacts.put(WEAVER, h.workspaceId, 'first', '<html><body>a</body></html>', { title: 'First' });
    artifacts.put(WEAVER, h.workspaceId, 'second', '<html><body>b</body></html>', { title: 'Second' });
    const list = artifacts.list(h.workspaceId);
    expect(list.map((a) => a.key)).toEqual(['second', 'first']);
    expect(list[0]).toMatchObject({ key: 'second', title: 'Second', revision: 1 });
  });

  it('lists every revision oldest first, for the viewer\'s revision picker', () => {
    artifacts.put(WEAVER, h.workspaceId, 'report', '<html><body>v1</body></html>');
    artifacts.put(WEAVER, h.workspaceId, 'report', '<html><body>v2</body></html>');
    expect(artifacts.revisions(h.workspaceId, 'report').map((r) => r.revision)).toEqual([1, 2]);
    expect(artifacts.revisions(h.workspaceId, 'missing')).toEqual([]);
  });

  it('an unknown key or revision returns null, never a body', () => {
    expect(artifacts.getRevision(h.workspaceId, 'missing')).toBeNull();
    artifacts.put(WEAVER, h.workspaceId, 'report', '<html><body>hi</body></html>');
    expect(artifacts.getRevision(h.workspaceId, 'report', 99)).toBeNull();
  });

  it('emits weaver_artifact.published for the daemon-level SSE/webhook plumbing', async () => {
    artifacts.put(WEAVER, h.workspaceId, 'report', '<html><body>hi</body></html>');
    await Promise.resolve(); // EventBus.emit fires listeners on a microtask
    expect(h.events.some((e) => e.type === 'weaver_artifact.published')).toBe(true);
  });

  it('the same key can exist on a ticket and in the workspace store with no collision', () => {
    const tickets = createTicketsService(h.ctx, h.deps);
    const ticket = tickets.create({ kind: 'system', id: null }, { kind: 'task', title: 'Unrelated task' });
    tickets.putDocument({ kind: 'system', id: null }, ticket.id, 'artifact:report', '<html><body>ticket</body></html>', { system: true });
    artifacts.put(WEAVER, h.workspaceId, 'report', '<html><body>workspace</body></html>');

    expect(tickets.getDocument(ticket.id, 'artifact:report')?.body).toBe('<html><body>ticket</body></html>');
    expect(artifacts.getRevision(h.workspaceId, 'report')).toEqual({ body: '<html><body>workspace</body></html>', revision: 1 });
  });
});
