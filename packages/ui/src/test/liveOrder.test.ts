/**
 * VS-337: the Live pages' running-first order and the between-turns grace window behind it.
 */
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LIVE_RUN_GRACE_MS, orderByRunning, useRunningWorkerIds } from '../lib/liveOrder';

function node(id: string, createdAt: string): { id: string; createdAt: string } {
  return { id, createdAt };
}

describe('orderByRunning', () => {
  it('puts a running item above a waiting item even when the waiting one is newer', () => {
    const items = [node('wait', '2026-09-02T00:00:00.000Z'), node('run', '2026-09-01T00:00:00.000Z')];
    expect(orderByRunning(items, (w) => w, new Set(['run'])).map((w) => w.id)).toEqual(['run', 'wait']);
  });

  it('orders each group newest first, with all running items above all waiting ones', () => {
    const items = [
      node('r-old', '2026-09-01T00:00:00.000Z'),
      node('w-old', '2026-09-01T00:00:00.000Z'),
      node('r-new', '2026-09-03T00:00:00.000Z'),
      node('w-new', '2026-09-02T00:00:00.000Z'),
    ];
    const running = new Set(['r-old', 'r-new']);
    expect(orderByRunning(items, (w) => w, running).map((w) => w.id)).toEqual(['r-new', 'r-old', 'w-new', 'w-old']);
  });

  it('breaks a createdAt tie by id, ascending', () => {
    const items = [node('b', '2026-09-01T00:00:00.000Z'), node('a', '2026-09-01T00:00:00.000Z')];
    expect(orderByRunning(items, (w) => w, new Set()).map((w) => w.id)).toEqual(['a', 'b']);
  });

  it('reads the ordering key through the accessor, so a cell can supply its agent', () => {
    const run = node('run', '2026-09-01T00:00:00.000Z');
    const wait = node('wait', '2026-09-02T00:00:00.000Z');
    const cells = [{ agent: wait }, { agent: run }];
    expect(orderByRunning(cells, (c) => c.agent, new Set(['run'])).map((c) => c.agent.id)).toEqual(['run', 'wait']);
  });
});

describe('useRunningWorkerIds', () => {
  afterEach(() => vi.useRealTimers());

  it('holds a worker that just stopped running for the grace window, then releases it', () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(({ active }: { active: ReadonlySet<string> }) => useRunningWorkerIds(active), {
      initialProps: { active: new Set(['a1', 'a2']) },
    });
    expect([...result.current].sort()).toEqual(['a1', 'a2']);

    rerender({ active: new Set(['a2']) });
    expect(result.current.has('a1')).toBe(true);

    act(() => vi.advanceTimersByTime(LIVE_RUN_GRACE_MS));
    expect(result.current.has('a1')).toBe(false);
    expect(result.current.has('a2')).toBe(true);
  });

  it('keeps a worker that becomes active again inside the window', () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(({ active }: { active: ReadonlySet<string> }) => useRunningWorkerIds(active), {
      initialProps: { active: new Set(['a1']) },
    });
    rerender({ active: new Set<string>() });
    expect(result.current.has('a1')).toBe(true);

    rerender({ active: new Set(['a1']) });

    // The worker is genuinely active again: it must not be dropped when the old window elapses.
    act(() => vi.advanceTimersByTime(LIVE_RUN_GRACE_MS));
    expect(result.current.has('a1')).toBe(true);
  });

  it('clears its pending timer on unmount', () => {
    vi.useFakeTimers();
    const { rerender, unmount } = renderHook(({ active }: { active: ReadonlySet<string> }) => useRunningWorkerIds(active), {
      initialProps: { active: new Set(['a1']) },
    });
    rerender({ active: new Set<string>() });
    expect(vi.getTimerCount()).toBe(1);

    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
