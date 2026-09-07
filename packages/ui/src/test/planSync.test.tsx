/**
 * The on-demand plan-limit sync's state machine (VS-84): which runtime is in flight, and what each
 * surface says afterwards. The daemon answers a sync it made too soon with the snapshot and a wait
 * rather than an error, so "too recent" has to arrive here as a message, not as a failure.
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { UsageAccountSync } from '../api/types';

/** Resolves or rejects when the test says so, so the in-flight state can be observed. */
let pending: { resolve: (out: UsageAccountSync) => void; reject: (e: Error) => void; vars: { runtimeId?: string } } | null = null;

vi.mock('../api/hooks', () => ({
  useSyncUsageAccounts: () => ({
    mutate: (vars: { runtimeId?: string }, cb: { onSuccess: (o: UsageAccountSync) => void; onError: (e: Error) => void; onSettled: () => void }) => {
      pending = {
        vars,
        resolve: (out) => { cb.onSuccess(out); cb.onSettled(); },
        reject: (e) => { cb.onError(e); cb.onSettled(); },
      };
    },
  }),
}));

const { usePlanSync } = await import('../lib/planSync');

const answer = (over: Partial<UsageAccountSync> = {}): UsageAccountSync => ({ accounts: [], synced: ['claude'], throttled: [], failed: [], ...over });

describe('usePlanSync', () => {
  beforeEach(() => { pending = null; });

  it('marks the runtime in flight until the sync settles, and says nothing when it worked', async () => {
    const { result } = renderHook(() => usePlanSync());
    act(() => result.current.onSync('claude'));

    expect(result.current.pendingRuntimeId).toBe('claude');
    expect(pending?.vars).toEqual({ runtimeId: 'claude' });

    act(() => pending!.resolve(answer()));
    await waitFor(() => expect(result.current.pendingRuntimeId).toBeNull());
    expect(result.current.messages).toEqual({});
  });

  it('reports a refusal as a wait, in whole seconds', async () => {
    const { result } = renderHook(() => usePlanSync());
    act(() => result.current.onSync('claude'));
    act(() => pending!.resolve(answer({ synced: [], throttled: [{ runtimeId: 'claude', nextSyncAt: '2026-09-07T10:00:30.000Z', retryAfterMs: 11_200 }] })));

    await waitFor(() => expect(result.current.messages['claude']).toBe('Synced too recently — try again in 12s.'));
    expect(result.current.pendingRuntimeId).toBeNull();
  });

  it('reports a probe that failed, with the reason the daemon gave', async () => {
    const { result } = renderHook(() => usePlanSync());
    act(() => result.current.onSync('claude'));
    act(() => pending!.resolve(answer({ synced: [], failed: [{ runtimeId: 'claude', message: 'the CLI is not logged in' }] })));

    await waitFor(() => expect(result.current.messages['claude']).toBe('Sync failed — the CLI is not logged in'));
  });

  it('reports a request that never reached the daemon', async () => {
    const { result } = renderHook(() => usePlanSync());
    act(() => result.current.onSync('claude'));
    act(() => pending!.reject(new Error('daemon unreachable')));

    await waitFor(() => expect(result.current.messages['claude']).toBe('Sync failed — daemon unreachable'));
  });

  it('clears the previous verdict for that runtime while the next attempt is in flight', async () => {
    const { result } = renderHook(() => usePlanSync());
    act(() => result.current.onSync('claude'));
    act(() => pending!.resolve(answer({ synced: [], failed: [{ runtimeId: 'claude', message: 'the CLI is not logged in' }] })));
    await waitFor(() => expect(result.current.messages['claude']).toBeTruthy());

    act(() => result.current.onSync('claude'));
    expect(result.current.messages['claude']).toBeUndefined();
    expect(result.current.pendingRuntimeId).toBe('claude');
  });

  it('leaves another runtime\'s message alone', async () => {
    const { result } = renderHook(() => usePlanSync());
    act(() => result.current.onSync('claude'));
    act(() => pending!.resolve(answer({ synced: [], failed: [{ runtimeId: 'claude', message: 'nope' }] })));
    await waitFor(() => expect(result.current.messages['claude']).toBeTruthy());

    act(() => result.current.onSync('codex'));
    expect(result.current.messages['claude']).toBe('Sync failed — nope');
  });
});
