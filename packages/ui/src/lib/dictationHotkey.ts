/**
 * The dictation shortcut's shared behaviour (VS-432): Ctrl on Linux/Windows, ⌘ on a Mac, plus
 * Shift and Space.
 *
 * One state machine drives both modes. A press released before `DICTATION_HOLD_MS` toggles: the
 * first press opens the mic and the next closes it. A press held past the threshold is
 * push-to-talk: releasing Space or either modifier stops. V1's `Composer` and V2's `ChatComposer`
 * both use this hook, so the two bindings cannot drift, and only a composer that still owns the key
 * passes `enabled: true` (VS-428's handoff to the Plan modal).
 */
import { useCallback, useEffect, useRef, useState } from 'react';

/** Held at least this long, the release stops; shorter, the press was a toggle. */
export const DICTATION_HOLD_MS = 1000;

/** `hold` while the chord is down and might still become push-to-talk; `toggle` once it is listening on a tap. */
export type DictationHotkeyMode = 'off' | 'hold' | 'toggle';

type Phase = 'idle' | 'pressed' | 'toggle';

export interface DictationHotkeyOptions {
  /** False on touch, on a disabled composer, or when the composer has handed the key to a modal. */
  enabled: boolean;
  listening: boolean;
  start: () => void;
  stop: () => void;
}

/** Ctrl/⌘ + Shift + Space. `code` is layout-independent, so a non-Latin space key still matches. */
function isDictationChord(e: KeyboardEvent): boolean {
  return (e.metaKey || e.ctrlKey) && e.shiftKey && e.code === 'Space';
}

/** The keys the chord is released by, in whatever order they come up. */
function isChordRelease(e: KeyboardEvent): boolean {
  return e.code === 'Space' || e.key === 'Meta' || e.key === 'Control' || e.key === 'Shift';
}

export function useDictationHotkey({ enabled, listening, start, stop }: DictationHotkeyOptions): DictationHotkeyMode {
  const [mode, setMode] = useState<DictationHotkeyMode>('off');
  // Read through refs so the window listeners are attached once and still see the current render's
  // callbacks and dictation state.
  const enabledRef = useRef(enabled);
  const listeningRef = useRef(listening);
  const startRef = useRef(start);
  const stopRef = useRef(stop);
  enabledRef.current = enabled;
  listeningRef.current = listening;
  startRef.current = start;
  stopRef.current = stop;

  const phase = useRef<Phase>('idle');
  const pressAt = useRef(0);

  const move = useCallback((next: Phase): void => {
    phase.current = next;
    setMode(next === 'pressed' ? 'hold' : next === 'toggle' ? 'toggle' : 'off');
  }, []);

  // Dictation can end without the chord: the mic button, an error, a send. The shortcut must not
  // keep thinking it is holding or toggling.
  useEffect(() => {
    if ((!listening || !enabled) && phase.current !== 'idle') move('idle');
  }, [listening, enabled, move]);

  useEffect(() => {
    const onDown = (e: KeyboardEvent): void => {
      if (!enabledRef.current) return;
      const chord = isDictationChord(e);
      // Swallow the chord even on auto-repeat, so a held Space never types into the textarea or
      // scrolls the page.
      if (chord) e.preventDefault();
      if (e.repeat || !chord) return;
      if (phase.current === 'pressed') return; // already down from this press
      if (phase.current === 'toggle') {
        // The chord pressed again is the toggle-off; its keyup must not be read as a release.
        stopRef.current();
        move('idle');
        return;
      }
      // A mic opened by the button is closed by the button; the chord does not claim it.
      if (listeningRef.current) return;
      pressAt.current = Date.now();
      move('pressed');
      startRef.current();
    };

    const onUp = (e: KeyboardEvent): void => {
      if (!enabledRef.current) return;
      if (phase.current !== 'pressed' || !isChordRelease(e)) return;
      if (!listeningRef.current) {
        move('idle');
        return;
      }
      if (Date.now() - pressAt.current >= DICTATION_HOLD_MS) {
        stopRef.current();
        move('idle');
        return;
      }
      move('toggle');
    };

    window.addEventListener('keydown', onDown);
    window.addEventListener('keyup', onUp);
    return () => {
      window.removeEventListener('keydown', onDown);
      window.removeEventListener('keyup', onUp);
    };
  }, [move]);

  return mode;
}
