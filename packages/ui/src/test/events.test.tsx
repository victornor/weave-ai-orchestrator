/** Which query keys one workspace event makes stale (`api/events.ts`). */
import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import type { WorkspaceEvent } from '@agent-conductor/shared';
import { invalidateFor } from '../api/events';
import { qk } from '../api/keys';

const event = (type: WorkspaceEvent['type'], over: Partial<WorkspaceEvent> = {}): WorkspaceEvent =>
  ({ type, seq: 1, entityId: 'dec_1', entityType: 'decision', payload: null, createdAt: '2026-09-05T10:00:00.000Z', ...over }) as WorkspaceEvent;

/** The keys `invalidateQueries` was called with, as JSON so they compare by value. */
function invalidated(evt: WorkspaceEvent): string[] {
  const qc = new QueryClient();
  const spy = vi.spyOn(qc, 'invalidateQueries').mockReturnValue(Promise.resolve());
  invalidateFor(qc, 'ws1', evt);
  return spy.mock.calls.map((c) => JSON.stringify((c[0] as { queryKey: unknown }).queryKey));
}

describe('decision events', () => {
  it('makes both the workspace decisions and the workspace list stale', () => {
    const keys = invalidated(event('decision.created'));
    expect(keys).toContain(JSON.stringify(qk.decisions('ws1')));
    expect(keys).toContain(JSON.stringify(qk.workspaces()));
  });

  it('does the same when a decision is answered, so a cleared badge drops at once', () => {
    expect(invalidated(event('decision.answered'))).toContain(JSON.stringify(qk.workspaces()));
  });

  it('leaves the workspace list alone for events that cannot change a Needs-you count', () => {
    expect(invalidated(event('ticket.created', { entityId: 'tk_1' }))).not.toContain(JSON.stringify(qk.workspaces()));
  });
});

describe('run events', () => {
  it('makes the conductor detail stale, so the chat header reads the turn that just ended', () => {
    const keys = invalidated(event('run.finished', { entityId: 'run_1', entityType: 'run' }));
    expect(keys).toContain(JSON.stringify(qk.conductor('ws1')));
    expect(keys).toContain(JSON.stringify(qk.runs('ws1')));
  });
});

/**
 * VS-95: until the project overview needed them, neither the changelog nor a project's merge queue
 * was ever invalidated — the Changelog view and the Merge queue page showed whatever they fetched
 * on mount. The changelog is derived from the activity rows these events write.
 */
describe('changelog events', () => {
  it.each([
    ['ticket.created'],
    ['ticket.status'],
    ['ticket.work_product'],
    ['ticket.merged'],
    ['role.hired'],
  ] as const)('makes the changelog stale on %s', (type) => {
    expect(invalidated(event(type, { entityId: 'tk_1' }))).toContain(JSON.stringify(qk.changelogRoot('ws1')));
  });

  it('leaves it alone for events that write no changelog entry', () => {
    for (const type of ['ticket.updated', 'ticket.assigned', 'role.paused'] as const) {
      expect(invalidated(event(type, { entityId: 'tk_1' }))).not.toContain(JSON.stringify(qk.changelogRoot('ws1')));
    }
  });
});

describe('merge queue events', () => {
  it('makes every project queue stale when a ticket changes status or lands', () => {
    for (const type of ['ticket.status', 'ticket.merged'] as const) {
      expect(invalidated(event(type, { entityId: 'tk_1' }))).toContain(JSON.stringify(qk.mergeQueueRoot('ws1')));
    }
  });

  it('keys a project queue under that root, so one invalidation reaches it', () => {
    expect(JSON.stringify(qk.mergeQueue('ws1', 'p1')).startsWith(JSON.stringify(qk.mergeQueueRoot('ws1')).slice(0, -1))).toBe(true);
  });
});

describe("a project's pull requests (VS-97)", () => {
  // The daemon drops its forge cache on exactly these three, so these are when there is something
  // new to read. A key nothing invalidates is a section frozen at mount — the VS-95 lesson.
  it.each(['ticket.work_product', 'ticket.status', 'ticket.merged'] as const)('is made stale by %s', (type) => {
    expect(invalidated(event(type, { entityId: 'tk_1', entityType: 'ticket' }))).toContain(JSON.stringify(qk.pullRequestsRoot('ws1')));
  });

  it('is left alone by a ticket event that cannot change a pull request', () => {
    expect(invalidated(event('ticket.updated', { entityId: 'tk_1', entityType: 'ticket' }))).not.toContain(JSON.stringify(qk.pullRequestsRoot('ws1')));
  });

  // VS-107: the diff keys have no listener of their own — they key under the same root, so the
  // three events above already reach them the way `qk.mergeQueue` reaches under `mergeQueueRoot`.
  it('keys the diff manifest and one file under the same root, so one invalidation reaches both', () => {
    const root = JSON.stringify(qk.pullRequestsRoot('ws1')).slice(0, -1);
    expect(JSON.stringify(qk.pullRequestDiffFiles('ws1', 'p1', 12)).startsWith(root)).toBe(true);
    expect(JSON.stringify(qk.pullRequestDiffFile('ws1', 'p1', 12, 'a.ts')).startsWith(root)).toBe(true);
  });
});

describe("a project's commit graph (VS-96)", () => {
  it.each(['ticket.work_product', 'ticket.status', 'ticket.merged', 'worker.spawned', 'worker.retired', 'project.updated'] as const)(
    'is made stale by %s',
    (type) => {
      expect(invalidated(event(type, { entityId: 'tk_1', entityType: 'ticket' }))).toContain(JSON.stringify(qk.historyRoot('ws1')));
    },
  );

  it('is left alone by a worker event that cannot change which branches exist', () => {
    expect(invalidated(event('worker.status', { entityId: 'ag_1', entityType: 'agent' }))).not.toContain(JSON.stringify(qk.historyRoot('ws1')));
  });

  it('is left alone by a ticket event that cannot change a branch', () => {
    expect(invalidated(event('ticket.updated', { entityId: 'tk_1', entityType: 'ticket' }))).not.toContain(JSON.stringify(qk.historyRoot('ws1')));
  });
});
