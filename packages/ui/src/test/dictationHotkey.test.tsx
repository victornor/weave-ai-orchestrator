/**
 * VS-432: the shared dictation chord, Ctrl (⌘ on a Mac) + Shift + Space — a quick press toggles,
 * a press held past `DICTATION_HOLD_MS` is push-to-talk. Exercised directly so every order the keys
 * can come up in is covered, not only the one a composer happens to emit.
 */
import { act, fireEvent, renderHook } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { DICTATION_HOLD_MS, useDictationHotkey } from '../lib/dictationHotkey';

/** The chord going down. `init` overrides any part of it, e.g. `repeat: true`. */
function chordDown(init: KeyboardEventInit = {}): boolean {
  return fireEvent.keyDown(window, { key: ' ', code: 'Space', ctrlKey: true, shiftKey: true, ...init });
}

function harness() {
  const start = vi.fn();
  const stop = vi.fn();
  let setListeningExternal: (v: boolean) => void = () => undefined;
  const { result, unmount } = renderHook(() => {
    const [listening, setListening] = useState(false);
    setListeningExternal = setListening;
    const mode = useDictationHotkey({
      enabled: true,
      listening,
      start: () => { start(); setListening(true); },
      stop: () => { stop(); setListening(false); },
    });
    return { mode, listening };
  });
  return { result, start, stop, endSession: () => act(() => setListeningExternal(false)), unmount };
}

describe('the shared dictation chord (VS-432)', () => {
  it('toggles on a quick press: one starts, the next stops', () => {
    const h = harness();
    chordDown();
    expect(h.start).toHaveBeenCalledTimes(1);
    expect(h.result.current.mode).toBe('hold');

    fireEvent.keyUp(window, { key: ' ', code: 'Space' });
    // Released before the threshold: still listening, now in toggle mode.
    expect(h.stop).not.toHaveBeenCalled();
    expect(h.result.current.mode).toBe('toggle');

    chordDown();
    expect(h.stop).toHaveBeenCalledTimes(1);
    expect(h.result.current.mode).toBe('off');
  });

  it('stops on release once the press is held past the threshold', () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(0);
    try {
      const h = harness();
      chordDown();
      clock.mockReturnValue(DICTATION_HOLD_MS);
      fireEvent.keyUp(window, { key: ' ', code: 'Space' });
      expect(h.stop).toHaveBeenCalledTimes(1);
      expect(h.result.current.mode).toBe('off');
    } finally {
      clock.mockRestore();
    }
  });

  it('treats a release just under the threshold as a toggle', () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(0);
    try {
      const h = harness();
      chordDown();
      clock.mockReturnValue(DICTATION_HOLD_MS - 1);
      fireEvent.keyUp(window, { key: ' ', code: 'Space' });
      expect(h.stop).not.toHaveBeenCalled();
      expect(h.result.current.mode).toBe('toggle');
    } finally {
      clock.mockRestore();
    }
  });

  it('ends a hold when a modifier comes up before Space', () => {
    for (const key of ['Control', 'Meta', 'Shift']) {
      const clock = vi.spyOn(Date, 'now').mockReturnValue(0);
      try {
        const h = harness();
        chordDown();
        clock.mockReturnValue(DICTATION_HOLD_MS + 10);
        fireEvent.keyUp(window, { key });
        expect(h.stop, key).toHaveBeenCalledTimes(1);
        expect(h.result.current.mode, key).toBe('off');
        h.unmount();
      } finally {
        clock.mockRestore();
      }
    }
  });

  it('ignores auto-repeat keydowns, neither restarting nor stopping', () => {
    const h = harness();
    chordDown();
    chordDown({ repeat: true });
    chordDown({ repeat: true });
    expect(h.start).toHaveBeenCalledTimes(1);
    expect(h.stop).not.toHaveBeenCalled();
    expect(h.result.current.mode).toBe('hold');
  });

  it('swallows the chord so Space never types into the page', () => {
    harness();
    expect(chordDown()).toBe(false);
    // Even an auto-repeat is swallowed, so a held Space cannot start inserting spaces.
    expect(chordDown({ repeat: true })).toBe(false);
  });

  it('returns to off when the session ends some other way', () => {
    const h = harness();
    chordDown();
    fireEvent.keyUp(window, { key: ' ', code: 'Space' });
    expect(h.result.current.mode).toBe('toggle');
    h.endSession();
    expect(h.result.current.mode).toBe('off');
    // And the next press starts a fresh session rather than toggling a stale one.
    chordDown();
    expect(h.start).toHaveBeenCalledTimes(2);
  });

  it('does nothing while disabled', () => {
    const start = vi.fn();
    const stop = vi.fn();
    const { result } = renderHook(() => useDictationHotkey({ enabled: false, listening: false, start, stop }));
    chordDown();
    expect(start).not.toHaveBeenCalled();
    expect(stop).not.toHaveBeenCalled();
    expect(result.current).toBe('off');
  });
});
