/**
 * `useCommittableField` (VS-141): the draft/status state machine behind every Settings field that
 * used to save only on blur. Exercised directly against a fake `onCommit`, independent of any field's
 * own parsing or markup.
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useCommittableField } from './commit-field';

function keyDown(key: string): React.KeyboardEvent {
  return { key, preventDefault: vi.fn() } as unknown as React.KeyboardEvent;
}

describe('useCommittableField', () => {
  it('moves idle to dirty on change, and back to idle if the value matches again', () => {
    const { result } = renderHook(() => useCommittableField({ value: 'a', onCommit: vi.fn(async () => {}) }));
    expect(result.current.status).toBe('idle');

    act(() => result.current.onChange('b'));
    expect(result.current.status).toBe('dirty');
    expect(result.current.draft).toBe('b');

    act(() => result.current.onChange('a'));
    expect(result.current.status).toBe('idle');
  });

  it('a resolved commit goes dirty -> saving -> saved, then reverts to idle after a delay', async () => {
    vi.useFakeTimers();
    try {
      const onCommit = vi.fn(async () => {});
      const { result } = renderHook(() => useCommittableField({ value: 'a', onCommit }));
      act(() => result.current.onChange('b'));
      act(() => result.current.commitNow());
      expect(result.current.status).toBe('saving');
      expect(onCommit).toHaveBeenCalledWith('b');

      await act(async () => { await Promise.resolve(); await Promise.resolve(); });
      expect(result.current.status).toBe('saved');

      await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
      expect(result.current.status).toBe('idle');
    } finally {
      vi.useRealTimers();
    }
  });

  it('Enter and blur both commit the current draft', async () => {
    const onCommit = vi.fn(async () => {});
    const { result } = renderHook(() => useCommittableField({ value: 'a', onCommit }));
    act(() => result.current.onChange('b'));
    act(() => result.current.onKeyDown(keyDown('Enter')));
    expect(onCommit).toHaveBeenCalledWith('b');
    await waitFor(() => expect(result.current.status).toBe('saved'));

    const { result: result2 } = renderHook(() => useCommittableField({ value: 'x', onCommit }));
    act(() => result2.current.onChange('y'));
    act(() => result2.current.onBlur());
    expect(onCommit).toHaveBeenCalledWith('y');
    await waitFor(() => expect(result2.current.status).toBe('saved'));
  });

  it('a non-Enter key does not commit', () => {
    const onCommit = vi.fn(async () => {});
    const { result } = renderHook(() => useCommittableField({ value: 'a', onCommit }));
    act(() => result.current.onChange('b'));
    act(() => result.current.onKeyDown(keyDown('Tab')));
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('plain Enter in multiline mode neither commits nor prevents the line break', () => {
    const onCommit = vi.fn(async () => {});
    const preventDefault = vi.fn();
    const { result } = renderHook(() => useCommittableField({ value: 'a', onCommit, multiline: true }));
    act(() => result.current.onChange('one\ntwo'));
    act(() => result.current.onKeyDown({ key: 'Enter', preventDefault } as unknown as React.KeyboardEvent));
    expect(preventDefault).not.toHaveBeenCalled();
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('Cmd/Ctrl+Enter commits a multiline field', async () => {
    const onCommit = vi.fn(async () => {});
    const { result } = renderHook(() => useCommittableField({ value: 'a', onCommit, multiline: true }));
    act(() => result.current.onChange('one\ntwo'));
    act(() => result.current.onKeyDown({ key: 'Enter', metaKey: true, preventDefault: vi.fn() } as unknown as React.KeyboardEvent));
    expect(onCommit).toHaveBeenCalledWith('one\ntwo');
    await waitFor(() => expect(result.current.status).toBe('saved'));
  });

  it('blur commits a multiline field', async () => {
    const onCommit = vi.fn(async () => {});
    const { result } = renderHook(() => useCommittableField({ value: 'a', onCommit, multiline: true }));
    act(() => result.current.onChange('one\ntwo'));
    act(() => result.current.onBlur());
    expect(onCommit).toHaveBeenCalledWith('one\ntwo');
    await waitFor(() => expect(result.current.status).toBe('saved'));
  });

  it('a rejected commit moves to error with the rejection message and keeps the draft', async () => {
    const onCommit = vi.fn(async () => { throw new Error('branch not found'); });
    const { result } = renderHook(() => useCommittableField({ value: 'a', onCommit }));
    act(() => result.current.onChange('nope'));
    act(() => result.current.commitNow());

    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.error).toBe('branch not found');
    expect(result.current.draft).toBe('nope');
  });

  it('retrying after an error calls onCommit again with the same draft', async () => {
    let fail = true;
    const onCommit = vi.fn(async () => { if (fail) throw new Error('nope'); });
    const { result } = renderHook(() => useCommittableField({ value: 'a', onCommit }));
    act(() => result.current.onChange('b'));
    act(() => result.current.commitNow());
    await waitFor(() => expect(result.current.status).toBe('error'));

    fail = false;
    act(() => result.current.commitNow());
    await waitFor(() => expect(result.current.status).toBe('saved'));
    expect(onCommit).toHaveBeenCalledTimes(2);
    expect(onCommit).toHaveBeenLastCalledWith('b');
  });

  it('resyncs the draft from a changed value while idle, but not while dirty or saving', async () => {
    const onCommit = vi.fn(async () => {});
    const { result, rerender } = renderHook(({ value }) => useCommittableField({ value, onCommit }), {
      initialProps: { value: 'a' },
    });
    rerender({ value: 'server-changed' });
    expect(result.current.draft).toBe('server-changed');

    act(() => result.current.onChange('typing'));
    rerender({ value: 'server-changed-again' });
    expect(result.current.draft).toBe('typing');
  });

  it('unmounting while dirty flushes the pending draft exactly once, without awaiting it', () => {
    const onCommit = vi.fn(async () => {});
    const { result, unmount } = renderHook(() => useCommittableField({ value: 'a', onCommit }));
    act(() => result.current.onChange('unsaved-edit'));

    unmount();
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith('unsaved-edit');
  });

  it('unmounting while clean does not commit anything', () => {
    const onCommit = vi.fn(async () => {});
    const { unmount } = renderHook(() => useCommittableField({ value: 'a', onCommit }));
    unmount();
    expect(onCommit).not.toHaveBeenCalled();
  });
});
