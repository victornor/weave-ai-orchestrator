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

/** A stable id for one of the chord's own keys, so a keyup can be matched to the chord that claimed it. */
function chordKeyId(e: KeyboardEvent): string | null {
  if (e.code === 'Space') return 'Space';
  if (e.key === 'Meta' || e.key === 'Control' || e.key === 'Shift') return e.key;
  return null;
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
  /**
   * True from the chord's keydown until every key that made it is up. A focused button is
   * activated by the **keyup** of Space, not its keydown, so swallowing only the keydown (VS-432)
   * left the keyup free to click a focused mic/stop/send button: a toggle-off could then be
   * followed by a second stop or a start, which is how a stop ended in a bogus "Transcription
   * failed" (VS-441). The chord is swallowed on both edges while it owns this flag.
   */
  const claimed = useRef(false);
  const claimedKeys = useRef<Set<string>>(new Set());

  const move = useCallback((next: Phase): void => {
    phase.current = next;
    setMode(next === 'pressed' ? 'hold' : next === 'toggle' ? 'toggle' : 'off');
  }, []);

  const release = useCallback((): void => {
    claimed.current = false;
    claimedKeys.current.clear();
  }, []);

  // Dictation can end without the chord: the mic button, an error, a send. The shortcut must not
  // keep thinking it is holding or toggling.
  useEffect(() => {
    if ((!listening || !enabled) && phase.current !== 'idle') move('idle');
  }, [listening, enabled, move]);

  // A window that loses focus (or a hidden tab) never delivers the keyup that would end a hold. If
  // the chord was mid-press it would sit on `pressed` forever, ignoring every later chord press and
  // leaving the mic open — the 5-minute recording of VS-441. A genuine hold stops (nobody can keep
  // holding an unfocused window); a tap that had not yet become a hold becomes a toggle, so the
  // next chord press still closes the mic rather than stranding it.
  useEffect(() => {
    const onBlur = (): void => {
      release();
      if (phase.current !== 'pressed') return;
      if (Date.now() - pressAt.current >= DICTATION_HOLD_MS) {
        stopRef.current();
        move('idle');
      } else {
        move('toggle');
      }
    };
    const onHidden = (): void => {
      if (document.visibilityState === 'hidden') onBlur();
    };
    window.addEventListener('blur', onBlur);
    document.addEventListener('visibilitychange', onHidden);
    return () => {
      window.removeEventListener('blur', onBlur);
      document.removeEventListener('visibilitychange', onHidden);
    };
  }, [move, release]);

  useEffect(() => {
    const onDown = (e: KeyboardEvent): void => {
      if (!enabledRef.current) return;
      const chord = isDictationChord(e);
      if (chord) {
        // Swallow the chord — on keydown so a held Space never types into the textarea or scrolls
        // the page, and (below) on keyup so it never activates a focused button.
        e.preventDefault();
        claimed.current = true;
        if (e.ctrlKey) claimedKeys.current.add('Control');
        if (e.metaKey) claimedKeys.current.add('Meta');
        if (e.shiftKey) claimedKeys.current.add('Shift');
        claimedKeys.current.add('Space');
      }
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
      const id = chordKeyId(e);
      if (claimed.current && id !== null) {
        // Swallow the keyup of any of the chord's keys while the chord owns them, so Space's keyup
        // cannot click the focused control. Modifier keyups are harmless but kept symmetric.
        if (isChordRelease(e)) e.preventDefault();
        claimedKeys.current.delete(id);
        if (claimedKeys.current.size === 0) claimed.current = false;
      }
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