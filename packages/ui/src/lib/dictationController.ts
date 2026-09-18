/**
 * One dictation session's behaviour, independent of where it is rendered (VS-450).
 *
 * The V2 chat composer and the shell-level dictation session both drive the same lifecycle: start a
 * session, stream the transcript into a draft, discard a result below three words (VS-439, VS-552),
 * reveal a long insert (VS-425), cancel on Escape (VS-489), and send the settled draft through the
 * same queued path the send arrow uses (VS-282, VS-416) — either from an explicit send or from the
 * keybinding's ending when the auto-send setting is on (VS-435, VS-494). Keeping it in one hook
 * means the in-chat composer and the off-chat floating bar cannot drift.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useDictation, isDictationTooShort, type Dictation } from './dictation';
import { useDictationAutoSend } from './dictationAutoSend';
import { REVEAL_MS, REVEAL_STEP_MS, revealedCount, usePrefersReducedMotion } from './streamReveal';

export interface DictationReveal {
  prefix: string;
  piece: string;
  shown: number;
}

export interface DictationController {
  dictation: Dictation;
  /** The VS-425 display overlay: a growing prefix of the committed draft, or null. */
  reveal: DictationReveal | null;
  pendingSend: boolean;
  pendingNotice: string | null;
  /** Set when a dictated insert lands; the textarea consumes it to scroll and place the caret (VS-416). */
  dictated: React.MutableRefObject<boolean>;
  start: () => void;
  /**
   * The Stop control's ending: end the session and leave the transcript in the composer. Never
   * sends, with the auto-send setting on or off (VS-489, VS-494).
   */
  stop: () => void;
  /**
   * The keybinding's ending — a toggle session pressed off, or a held chord released (VS-494). With
   * the auto-send setting on it arms the queued send before stopping, so the settled transcript goes
   * out through the same path a queued send arrow uses; with it off it just stops.
   */
  stopByChord: () => void;
  /**
   * Abandon the session without sending: clear any queued send, discard the transcript and restore
   * the draft that was there before the mic opened (VS-489). Escape uses this.
   */
  cancel: () => void;
  requestSend: () => void;
}

export interface DictationControllerOptions {
  /** The committed draft as it is now; reacts to a send or a clear so the reveal can end (VS-425). */
  value: string;
  /** Commit a whole draft. */
  writeValue: (text: string) => void;
  /** Submit the settled text. Called once a queued send is ready, or immediately for a plain send. */
  submit: (text: string) => void | Promise<void>;
  /** Whether a submit is allowed right now (not disabled, not already sending). */
  canSubmit: () => boolean;
  /** Whether anything is staged to go with the text (attachments). */
  hasFiles: () => boolean;
}

export function useDictationController(opts: DictationControllerOptions): DictationController {
  const writeValue = useRef(opts.writeValue);
  const submit = useRef(opts.submit);
  const canSubmit = useRef(opts.canSubmit);
  const hasFiles = useRef(opts.hasFiles);
  writeValue.current = opts.writeValue;
  submit.current = opts.submit;
  canSubmit.current = opts.canSubmit;
  hasFiles.current = opts.hasFiles;

  const base = useRef('');
  const discarded = useRef(false);
  /** True when the session was abandoned (Escape): restore `base` when it settles, never send. */
  const cancelled = useRef(false);
  const sessionTranscript = useRef('');
  const sessionRan = useRef(false);
  const listeningRef = useRef(false);
  const reducedMotion = usePrefersReducedMotion();
  const [reveal, setReveal] = useState<DictationReveal | null>(null);
  const revealTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const dictated = useRef(false);
  const [pendingSend, setPendingSend] = useState(false);
  const pendingSendRef = useRef(false);
  const [pendingNotice, setPendingNotice] = useState<string | null>(null);
  const autoSend = useDictationAutoSend();

  const stopReveal = useCallback((): void => {
    if (revealTimer.current !== null) clearInterval(revealTimer.current);
    revealTimer.current = null;
    setReveal(null);
  }, []);
  useEffect(() => stopReveal, [stopReveal]);

  const dictation = useDictation((transcript, final) => {
    const piece = transcript.trim();
    sessionTranscript.current = transcript;
    // A short result is never a deliberate message (VS-439). The decision is taken over the whole
    // session transcript and applied when the session ends, so interim words still show while
    // talking and a mid-sentence Android restatement (marked final by the recognizer) cannot wipe
    // the box.
    discarded.current = piece.length > 0 && isDictationTooShort(transcript);
    if (!piece) return;
    const back = base.current;
    const joiner = back && !back.endsWith(' ') ? ' ' : '';
    const full = `${back}${joiner}${piece}`;
    // The session has already been stopped and this is its outcome: put the draft back as it was
    // before the mic opened, taking every interim word with it, and never animate it in.
    if (final && !listeningRef.current && discarded.current) {
      stopReveal();
      writeValue.current(back);
      return;
    }
    // Commit the whole draft immediately: the reveal is display only, so a send queued while
    // dictating submits every last word (VS-416), not the prefix on screen mid-animation.
    writeValue.current(full);
    if (!final || reducedMotion || typeof setInterval !== 'function' || discarded.current) {
      stopReveal();
      return;
    }
    stopReveal();
    const prefix = `${back}${joiner}`;
    let step = 0;
    const total = Math.max(1, Math.ceil(REVEAL_MS / REVEAL_STEP_MS));
    dictated.current = true;
    setReveal({ prefix, piece, shown: 0 });
    revealTimer.current = setInterval(() => {
      step += 1;
      dictated.current = true;
      if (step >= total) {
        // The reveal is over: drop it, so the displayed value follows the committed draft.
        if (revealTimer.current !== null) clearInterval(revealTimer.current);
        revealTimer.current = null;
        setReveal(null);
      } else {
        setReveal({ prefix, piece, shown: revealedCount(piece.length, step * REVEAL_STEP_MS, REVEAL_MS) });
      }
    }, REVEAL_STEP_MS);
  });

  listeningRef.current = dictation.listening;

  const start = useCallback((): void => {
    base.current = opts.value;
    cancelled.current = false;
    // Assume too short until the transcript proves otherwise: a session that produces no words at
    // all is discarded too (VS-439).
    discarded.current = true;
    sessionTranscript.current = '';
    sessionRan.current = true;
    setPendingNotice(null);
    dictation.start();
  }, [dictation, opts.value]);

  // The Stop control's ending — the mic button and the off-page bar's Stop — ends the session and
  // leaves the transcript in the composer; it never sends (VS-489, VS-494). Only an explicit send,
  // or the keybinding's ending below when the setting is on, submits.
  const stop = useCallback((): void => {
    dictation.stop();
  }, [dictation]);

  // The keybinding's ending (VS-494). With "Send automatically when dictation ends" on it arms the
  // existing queued send before stopping, so the settled transcript goes out through the same path a
  // queued send arrow uses; with it off it just stops and leaves the transcript. `requestSend()`
  // below stops the raw session so a manual send is never armed twice.
  const stopByChord = useCallback((): void => {
    if (autoSend && canSubmit.current() && !pendingSendRef.current) {
      pendingSendRef.current = true;
      setPendingSend(true);
    }
    dictation.stop();
  }, [autoSend, dictation]);

  // Escape means "abandon the dictation and send nothing" (VS-489). It never arms the queued send,
  // and it drops any send that was already queued, so auto-send cannot fire. The restore of the
  // pre-dictation draft happens below once the attempt settles, the same place the VS-439 discard
  // lives, so a long cancelled transcript is put back too.
  const cancel = useCallback((): void => {
    cancelled.current = true;
    pendingSendRef.current = false;
    setPendingSend(false);
    setPendingNotice(null);
    stopReveal();
    dictation.cancel();
  }, [dictation, stopReveal]);

  // Send means "finish the dictation and send it". The transcript lands only after `stop()` —
  // synchronously-late for Web Speech, as a daemon response for Voxtype — so the send queues and
  // the effect below submits once the attempt has settled. A second press while queued is a no-op.
  const requestSend = useCallback((): void => {
    if (!canSubmit.current()) return;
    setPendingNotice(null);
    if (dictation.listening || dictation.transcribing) {
      if (pendingSendRef.current) return;
      pendingSendRef.current = true;
      setPendingSend(true);
      if (dictation.listening) dictation.stop();
      return;
    }
    const t = opts.value.trim();
    if (!t && !hasFiles.current()) return;
    void submit.current(t);
  }, [dictation, opts.value]);

  // A send (which clears the draft) or any other change to the committed draft ends the reveal: it
  // must never stay pinned to text the draft has moved on from (VS-425).
  useEffect(() => {
    if (reveal && opts.value !== `${reveal.prefix}${reveal.piece}`) stopReveal();
  }, [opts.value, reveal, stopReveal]);

  // A session's outcome below three words never lands (VS-439, VS-552), and a cancelled session never
  // lands whatever its length (VS-489): once the attempt settles, put the draft back exactly as it
  // was before the mic opened. Declared before the queued send below, so the two run in the same
  // commit in that order.
  useEffect(() => {
    if (!dictation.settled || !sessionRan.current) return;
    sessionRan.current = false;
    if (!cancelled.current && !isDictationTooShort(sessionTranscript.current)) return;
    cancelled.current = false;
    stopReveal();
    writeValue.current(base.current);
  }, [dictation.settled, stopReveal]);

  // A queued send submits when the attempt settles; reading `opts.value` here — not a value captured
  // at press time — keeps the transcript that landed (VS-282). A failed or empty transcript submits
  // nothing; a discarded short result clears the queued state instead of sending the old draft.
  useEffect(() => {
    if (!pendingSend || !dictation.settled) return;
    pendingSendRef.current = false;
    setPendingSend(false);
    if (!canSubmit.current()) return;
    if (dictation.error) return;
    if (discarded.current) {
      setPendingNotice('That dictation was too short to insert, so nothing was sent.');
      return;
    }
    const t = opts.value.trim();
    if (!t && !hasFiles.current()) {
      setPendingNotice('Nothing was recognized, so nothing was sent.');
      return;
    }
    void submit.current(t);
  }, [pendingSend, dictation.settled, dictation.error, opts.value]);

  return { dictation, reveal, pendingSend, pendingNotice, dictated, start, stop, stopByChord, cancel, requestSend };
}