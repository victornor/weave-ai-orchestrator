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
