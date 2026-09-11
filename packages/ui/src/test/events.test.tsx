/** Which query keys one workspace event makes stale (`api/events.ts`). */
import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import type { Decision, WorkspaceEvent } from '@agent-conductor/shared';
import { invalidateFor } from '../api/events';
import { qk } from '../api/keys';

const event = (type: WorkspaceEvent['type'], over: Partial<WorkspaceEvent> = {}): WorkspaceEvent =>
  ({ type, seq: 1, entityId: 'dec_1', entityType: 'decision', payload: null, createdAt: '2026-09-05T10:00:00.000Z', ...over }) as WorkspaceEvent;

const fakeDecision = (id: string, status: Decision['status'], over: Partial<Decision> = {}): Decision => ({
  id, workspaceId: 'ws1', ticketId: 'tk_1', projectId: null, kind: 'plan_approval', owner: 'human',
  askedByAgentId: null, askedInRunId: null, title: 'Plan', context: 'ctx', options: [], inputs: [],
  allowFreeText: false, recommendation: null, status, answerKey: null, answerText: null,
  answerInputs: null, answeredByKind: null, answeredById: null, answeredAt: null, expiresAt: null,
  target: null, correlationKey: `plan_approval:tk_1`, createdAt: '2026-09-05T10:00:00.000Z',
  conductorReviewStatus: 'unseen', conductorReviewedAt: null, conductorReviewNote: null, conductorReviewedByAgentId: null,
  ...over,
});

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

  it('treats a conductor-review update the same as an answer (VS-223)', () => {
    const keys = invalidated(event('decision.updated'));
    expect(keys).toContain(JSON.stringify(qk.decisions('ws1')));
    expect(keys).toContain(JSON.stringify(qk.decision('ws1', 'dec_1')));
    expect(keys).toContain(JSON.stringify(qk.briefing('ws1')));
    expect(keys).toContain(JSON.stringify(qk.workspaces()));
  });

  it('leaves the workspace list alone for events that cannot change a Needs-you count', () => {
    expect(invalidated(event('ticket.created', { entityId: 'tk_1' }))).not.toContain(JSON.stringify(qk.workspaces()));
  });
});

/**
 * VS-140: closing the round trip between a decision leaving `open` and the view reflecting it.
 * `invalidateFor` patches every cached decisions-list query synchronously from the event's own
 * payload, before the `invalidateQueries` refetch it also still triggers.
 */
describe('decision cache patching', () => {
  const withPatched = (evt: WorkspaceEvent, key: readonly unknown[], seed: Decision[]): unknown => {
    const qc = new QueryClient();
    vi.spyOn(qc, 'invalidateQueries').mockReturnValue(Promise.resolve());
    qc.setQueryData(key, seed);
    invalidateFor(qc, 'ws1', evt);
    return qc.getQueryData(key);
  };

  it('removes a superseded decision from a query filtered to status: open, without a refetch', () => {
    const key = [...qk.decisions('ws1'), { status: 'open', owner: 'human' }];
    const seed = [fakeDecision('dec_1', 'open'), fakeDecision('dec_2', 'open')];
    const next = event('decision.superseded', { payload: fakeDecision('dec_1', 'superseded') });
    expect(withPatched(next, key, seed)).toEqual([fakeDecision('dec_2', 'open')]);
  });

  it('replaces an answered decision in place in a query whose filter still includes answered', () => {
    const key = [...qk.decisions('ws1'), { status: ['open', 'answered'], owner: 'human', limit: 200 }];
    const seed = [fakeDecision('dec_1', 'open')];
    const answered = fakeDecision('dec_1', 'answered', { answerKey: 'approve', answeredByKind: 'human', answeredAt: '2026-09-08T19:00:00.000Z' });
    const next = event('decision.answered', { payload: answered });
    expect(withPatched(next, key, seed)).toEqual([answered]);
  });

  it('leaves a query untouched when the event names a decision it never had', () => {
    const key = [...qk.decisions('ws1'), { status: 'open', owner: 'human' }];
    const seed = [fakeDecision('dec_2', 'open')];
    const next = event('decision.superseded', { entityId: 'dec_1', payload: fakeDecision('dec_1', 'superseded') });
    expect(withPatched(next, key, seed)).toBe(seed);
  });

  it('does not touch the single-decision detail cache key when it has never been fetched', () => {
    const qc = new QueryClient();
    vi.spyOn(qc, 'invalidateQueries').mockReturnValue(Promise.resolve());
    invalidateFor(qc, 'ws1', event('decision.superseded', { payload: fakeDecision('dec_1', 'superseded') }));
    expect(qc.getQueryData(qk.decision('ws1', 'dec_1'))).toBeUndefined();
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

describe("a project's sync state (VS-131)", () => {
  it('is made stale, for that project alone, by project.updated', () => {
    const keys = invalidated(event('project.updated', { entityId: 'p1', entityType: 'project' }));
    expect(keys).toContain(JSON.stringify(qk.projectSync('ws1', 'p1')));
    expect(keys).not.toContain(JSON.stringify(qk.projectSync('ws1', 'p2')));
  });

  it('is left alone by an event on something other than a project', () => {
    expect(invalidated(event('ticket.updated', { entityId: 'tk_1', entityType: 'ticket' })))
      .not.toContain(JSON.stringify(qk.projectSync('ws1', 'tk_1')));
  });
});

describe('knowledge context events (VS-110)', () => {
  it('makes the knowledge-usage root and the naming ticket\'s own key stale', () => {
    const keys = invalidated(event('knowledge_usage.recorded', { entityId: 'run_1', entityType: 'run', payload: { runId: 'run_1', ticketId: 'tk_1' } }));
    expect(keys).toContain(JSON.stringify(qk.knowledgeUsageRoot('ws1')));
    expect(keys).toContain(JSON.stringify(qk.ticketKnowledgeUsage('ws1', 'tk_1')));
  });

  it('skips the ticket key when the run recorded against carries no ticket', () => {
    const keys = invalidated(event('knowledge_usage.recorded', { entityId: 'run_1', entityType: 'run', payload: { runId: 'run_1', ticketId: null } }));
    expect(keys).toContain(JSON.stringify(qk.knowledgeUsageRoot('ws1')));
    expect(keys).not.toContain(JSON.stringify(qk.ticketKnowledgeUsage('ws1', 'tk_1')));
  });
});

describe('routine events (VS-220)', () => {
  it('makes the scheduled-tasks list stale', () => {
    for (const type of ['routine.created', 'routine.updated', 'routine.removed', 'routine.fired'] as const) {
      const keys = invalidated(event(type, { entityId: 'rt_1', entityType: 'routine' }));
      expect(keys).toContain(JSON.stringify(qk.routines('ws1')));
      expect(keys).toContain(JSON.stringify(qk.routine('ws1', 'rt_1')));
    }
  });
});
