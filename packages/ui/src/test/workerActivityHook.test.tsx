/** The V2 live-activity hook (VS-368): a pushed frame patches its worker's entry, coalesced per animation frame, and the pending frame is cancelled on unmount. */
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkspaceEvent } from '@weave-ai/shared';

const state = vi.hoisted(() => ({ onEvent: undefined as ((e: unknown) => void) | undefined }));

vi.mock('../api/context', () => ({
  useWorkspaceEvents: (fn: (e: unknown) => void) => {
    state.onEvent = fn;
  },
}));

const { useWorkerActivity } = await import('../api/workerActivity');

const frame = (over: Record<string, unknown> = {}): WorkspaceEvent =>
  ({
    type: 'worker.activity',
    seq: 0,
    workspaceId: 'ws1',
    entityType: 'worker',
    entityId: 'a1',
    createdAt: '2026-09-13T12:00:00.000Z',
    payload: { agentId: 'a1', ticketId: 'tk_1', activity: { verb: 'testing', label: 'Running tests', target: null, since: '2026-09-13T12:00:00.000Z' }, tests: { passed: 30, total: 30 } },
    ...over,
  }) as unknown as WorkspaceEvent;

const flushFrame = async (evt: WorkspaceEvent): Promise<void> => {
  await act(async () => {
    state.onEvent?.(evt);
    await new Promise((r) => requestAnimationFrame(() => r(null)));
  });
};

beforeEach(() => {
  state.onEvent = undefined;
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('useWorkerActivity', () => {
  it('patches the pushed worker into the map and ignores other event types', async () => {
    const { result } = renderHook(() => useWorkerActivity());
    expect(result.current.size).toBe(0);

    await flushFrame(frame());
    expect(result.current.get('a1')?.activity?.label).toBe('Running tests');

    await flushFrame(frame({ type: 'run.event', payload: { agentId: 'a2' } }));
    expect(result.current.has('a2')).toBe(false);
  });

  it('replaces a worker\'s entry with a later frame\'s state, including null', async () => {
    const { result } = renderHook(() => useWorkerActivity());
    await flushFrame(frame());
    await flushFrame(frame({ payload: { agentId: 'a1', ticketId: 'tk_1', activity: null, tests: null } }));
    expect(result.current.get('a1')).toEqual({ agentId: 'a1', ticketId: 'tk_1', activity: null, tests: null });
  });

  it('cancels a scheduled update on unmount', async () => {
    const cancel = vi.spyOn(globalThis, 'cancelAnimationFrame');
    const { unmount } = renderHook(() => useWorkerActivity());
    act(() => {
      state.onEvent?.(frame());
    });
    unmount();
    expect(cancel).toHaveBeenCalled();
  });
});
