import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ATTACHMENT_IMAGE_TYPES, ATTACHMENT_MAX_PER_MESSAGE, ATTACHMENT_TEXT_TYPES } from '@weave-ai/shared';
import { useDictation } from '../lib/dictation';
import { cx } from '../lib/cx';
import { StatusGlyph } from './StatusGlyph';
import { VoiceMeter } from './VoiceMeter';

const ACCEPTED_ATTACHMENT_TYPES = [...ATTACHMENT_IMAGE_TYPES, ...ATTACHMENT_TEXT_TYPES];
const ACCEPT_ATTR = ACCEPTED_ATTACHMENT_TYPES.join(',');

/**
 * Whether a drag is carrying files, and so is an attachment drag rather than a dragged link or a
 * selection. Checked on every drag event so non-file drags pass straight through to the browser,
 * including text dragged within the textarea (VS-277).
 */
function dragHasFiles(dt: DataTransfer | null): boolean {
  return Array.from(dt?.types ?? []).includes('Files');
}

export type ComposerState = 'idle' | 'queued';

/**
 * The input stops growing here and scrolls internally, so the mic and send controls never move off
 * screen. Kept in step with the `max-h` on the textarea, which clamps it further on a short viewport —
 * including one the keyboard has shortened; 12rem is this number.
 */
const MAX_INPUT_PX = 192;

export interface ComposerProps {
  placeholder?: string;
  /** "Conductor is replying — your message is queued" when the agent is mid-turn. */
  queuedReason?: string | null;
  queuedCount?: number;
  disabled?: boolean;
  autoFocus?: boolean;
  value?: string;
  onChange?: (v: string) => void;
  onSubmit: (text: string, files?: File[], idempotencyKey?: string) => void | Promise<void>;
  /** rendered above the input; used by "Revise…" to show what it is scoped to. */
  scope?: React.ReactNode;
  rows?: number;
  submitLabel?: string;
  className?: string;
  /** Browse + paste, weave chat only (VS-133) — ticket comments, decision notes and revise-plan notes carry none. */
  allowAttachments?: boolean;
  /** Controlled, like `value`/`onChange`: the parent clears it on a confirmed send and leaves it alone on a failed one. */
  attachments?: File[];
  onAttachmentsChange?: (files: File[]) => void;
}

function AttachIcon(): React.ReactElement {
  return (
    <svg viewBox="0 0 16 16" className="size-4" aria-hidden>
      <path
        d="M11 4.5v6a3 3 0 0 1-6 0V4a2 2 0 0 1 4 0v5.5a1 1 0 0 1-2 0V5"
        stroke="currentColor" strokeWidth="1.3" fill="none" strokeLinecap="round" strokeLinejoin="round"
      />
    </svg>
  );
}

function MicIcon({ slashed }: { slashed?: boolean }): React.ReactElement {
  return (
    <svg viewBox="0 0 16 16" className="size-4" aria-hidden>
      <rect x="5.6" y="1.4" width="4.8" height="8.2" rx="2.4" fill="currentColor" />
      <path d="M3.4 7.4a4.6 4.6 0 0 0 9.2 0M8 12v2.6" stroke="currentColor" strokeWidth="1.3" fill="none" strokeLinecap="round" />
      {slashed ? <path d="M2.2 2.2 13.8 13.8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /> : null}
    </svg>
  );
}

function SendIcon(): React.ReactElement {
  return (
    <svg viewBox="0 0 12 12" className="size-2.5" aria-hidden>
      <path d="M0 0 L12 6 L0 12 L2.6 6 Z" fill="currentColor" />
    </svg>
  );
}

/**
 * The one composer: chat, ticket comments, decision notes, revise-plan notes.
 * Mic is tap-to-toggle on touch and push-to-talk on ⌘⇧M at a desk — "a desk
 * user never leaves a hot mic open".
 */
export function Composer({
  placeholder = 'Tell the conductor what you need…',
  queuedReason,
  queuedCount = 0,
  disabled,
  autoFocus,
  value,
  onChange,
  onSubmit,
  scope,
  rows = 1,
  submitLabel = 'Send',
  className,
  allowAttachments,
  attachments,
  onAttachmentsChange,
}: ComposerProps): React.ReactElement {
  const [internal, setInternal] = useState('');
  const [diagnosticsCopied, setDiagnosticsCopied] = useState(false);
  const text = value ?? internal;
  const set = useCallback((v: string) => (onChange ? onChange(v) : setInternal(v)), [onChange]);
  const ta = useRef<HTMLTextAreaElement>(null);
  const base = useRef('');
  const [explain, setExplain] = useState(false);
  const startedByKey = useRef(false);

  const [internalFiles, setInternalFiles] = useState<File[]>([]);
  const files = attachments ?? internalFiles;
  const setFiles = useCallback((f: File[]) => (onAttachmentsChange ? onAttachmentsChange(f) : setInternalFiles(f)), [onAttachmentsChange]);
  const fileInput = useRef<HTMLInputElement>(null);
  const [attachError, setAttachError] = useState<string | null>(null);
  // A depth counter, not `relatedTarget`: dragenter/dragleave fire for every child the pointer
  // crosses, so clearing on the first dragleave would flicker across the chips, textarea and
  // buttons. `relatedTarget` is null on a drag that leaves the window and cannot be trusted to tell
  // containment here (VS-277).
  const [dragActive, setDragActive] = useState(false);
  const dragDepth = useRef(0);
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const [submitFailed, setSubmitFailed] = useState(false);
  const lastFailed = useRef<{ key: string; text: string; fileNames: string } | null>(null);
  const inFlightLabel = useRef<'Sending…' | 'Uploading and sending…'>('Sending…');
  // A non-streaming (Voxtype) send is queued until its transcript lands: the ref makes a second press
  // in the same tick a no-op before a re-render, and the state drives the queued UI (VS-282).
  const [pendingSend, setPendingSend] = useState(false);
  const pendingSendRef = useRef(false);
  const [pendingNotice, setPendingNotice] = useState<string | null>(null);

  const addFiles = useCallback((incoming: File[]): void => {
    const accepted = incoming.filter((f) => (ACCEPTED_ATTACHMENT_TYPES as readonly string[]).includes(f.type));
    if (accepted.length < incoming.length) setAttachError('Only images (PNG/JPEG/GIF/WebP) and plain text/markdown files are accepted.');
    else setAttachError(null);
    const combined = [...files, ...accepted].slice(0, ATTACHMENT_MAX_PER_MESSAGE);
    if (files.length + accepted.length > ATTACHMENT_MAX_PER_MESSAGE) setAttachError(`At most ${ATTACHMENT_MAX_PER_MESSAGE} files per message.`);
    setFiles(combined);
  }, [files, setFiles]);

  const removeFile = useCallback((i: number): void => setFiles(files.filter((_, idx) => idx !== i)), [files, setFiles]);

  // `base` is whatever was in the box when the mic opened, and it does not move while it is open:
  // the hook hands over the whole transcript so far on every event, so each one replaces the last.
  // Committing interim text into `base` here is what appended the growing phrase to itself (VS-70).
  const dictation = useDictation(
    (transcript) => {
      const piece = transcript.trim();
      if (!piece) return;
      set(`${base.current}${base.current && !base.current.endsWith(' ') ? ' ' : ''}${piece}`);
    },
  );

  const isTouch = typeof window !== 'undefined' && window.matchMedia('(hover: none)').matches;

  const startMic = useCallback(() => {
    if (dictation.mode === 'unavailable') {
      setExplain(true);
      return;
    }
    base.current = text;
    setPendingNotice(null);
    dictation.start();
  }, [dictation, text]);

  // Push-to-talk on ⌘⇧M / Ctrl⇧M at a desk; tap-to-toggle on touch.
  useEffect(() => {
    if (isTouch) return;
    const down = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.code === 'KeyM' && !dictation.listening) {
        e.preventDefault();
        startedByKey.current = true;
        startMic();
      }
    };
    // Releasing the chord ends push-to-talk; a mic started by click is only stopped by click.
    const up = (e: KeyboardEvent) => {
      if (!startedByKey.current || !dictation.listening) return;
      if (e.code === 'KeyM' || e.key === 'Meta' || e.key === 'Control' || e.key === 'Shift') { startedByKey.current = false; dictation.stop(); }
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, [isTouch, dictation, startMic]);

  useEffect(() => {
    if (autoFocus) ta.current?.focus();
  }, [autoFocus]);

  // A composer that opens on a restored draft puts the caret after the text: the human is
  // continuing a sentence, not editing from its start. Mount only — moving it on every change
  // would fight typing.
  useEffect(() => {
    const el = ta.current;
    if (el?.value) el.setSelectionRange(el.value.length, el.value.length);
  }, []);

  // Grow to fit, then stop and scroll inside. Measuring needs the box collapsed, which throws the
  // scroll position away, so it is put back afterwards: at the bottom when the caret is at the end
  // of the text — always so while dictating, since the transcript is appended — and where the
  // browser already left it otherwise. Layout effect, so the wrong height is never painted.
  useLayoutEffect(() => {
    const el = ta.current;
    if (!el) return;
    const atEnd = el.selectionStart === el.value.length && el.selectionEnd === el.value.length;
    const prev = el.scrollTop;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, MAX_INPUT_PX)}px`;
    el.scrollTop = atEnd ? el.scrollHeight : prev;
  }, [text]);

  // The single submit path, shared by a normal send and a queued finish-and-send, so the idempotency
  // key, the in-flight lock, the progress label and the failure retention cannot drift between them.
  const doSend = useCallback((t: string) => {
    const fileNames = files.map((f) => f.name).join('\0');
    const reused = lastFailed.current && lastFailed.current.text === t && lastFailed.current.fileNames === fileNames
      ? lastFailed.current.key
      : crypto.randomUUID();
    inFlightLabel.current = files.length > 0 ? 'Uploading and sending…' : 'Sending…';
    submittingRef.current = true;
    setSubmitting(true);
    setSubmitFailed(false);
    // Cleared only once the send is confirmed: a rejected send (attachment or plain text) leaves
    // the composer exactly as the human left it so the attempt can be retried (VS-148). `onSubmit`
    // is expected to report the failure itself (a toast); this only decides what to keep on screen.
    Promise.resolve(onSubmit(t, files.length > 0 ? files : undefined, reused)).then(() => {
      lastFailed.current = null;
      set('');
      base.current = '';
      setFiles([]);
      setAttachError(null);
    }).catch(() => {
      lastFailed.current = { key: reused, text: t, fileNames };
      setSubmitFailed(true);
    }).finally(() => {
      submittingRef.current = false;
      setSubmitting(false);
    });
  }, [files, onSubmit, set, setFiles]);

  const send = useCallback(() => {
    if (disabled || submittingRef.current) return;
    setPendingNotice(null);
    // Non-streaming (Voxtype): send means "finish the dictation and send it". While recording it
    // stops; either way it queues here until the transcript lands, and the effect below submits it
    // then. A second press while queued is a no-op, so one press sequence is one message (VS-282).
    if (dictation.mode === 'upload' && (dictation.listening || dictation.transcribing)) {
      if (pendingSendRef.current) return;
      pendingSendRef.current = true;
      setPendingSend(true);
      if (dictation.listening) {
        startedByKey.current = false;
        dictation.stop();
      }
      return;
    }
    const t = text.trim();
    if (!t) return;
    // Sending ends the utterance. A mic left open would keep appending to an input the human has
    // already sent, so it closes here — button and ⏎ alike — before the input is cleared.
    if (dictation.listening) {
      startedByKey.current = false;
      dictation.stop();
    }
    doSend(t);
  }, [disabled, text, dictation, doSend]);

  // A queued non-streaming send submits when the attempt settles. `transcribing` going false is the
  // one signal the attempt is over (VS-195); reading `text` here — not a value captured when the
  // button was pressed — is what keeps the transcript rather than the pre-press text (VS-282).
  useEffect(() => {
    if (!pendingSend || dictation.transcribing) return;
    pendingSendRef.current = false;
    setPendingSend(false);
    // A failed or empty transcript submits nothing: the hook's own alert says why, and the composer
    // keeps whatever text exists.
    if (dictation.error) return;
    const t = text.trim();
    if (t) {
      doSend(t);
      return;
    }
    setPendingNotice('Nothing was recognized, so nothing was sent.');
  }, [pendingSend, dictation.transcribing, dictation.error, text, doSend]);

  const onPaste = useCallback((e: React.ClipboardEvent<HTMLTextAreaElement>): void => {
    if (!allowAttachments) return;
    const items = Array.from(e.clipboardData?.items ?? []);
    const pasted = items.filter((i) => i.kind === 'file').map((i) => i.getAsFile()).filter((f): f is File => f !== null);
    if (pasted.length === 0) return;
    // A pasted image replaces the clipboard's plain-text fallback, which browsers offer alongside a
    // copied screenshot but which is never what the human meant to paste here.
    e.preventDefault();
    addFiles(pasted);
  }, [allowAttachments, addFiles]);

  const clearDrag = useCallback((): void => {
    dragDepth.current = 0;
    setDragActive(false);
  }, []);

  const onDragEnter = useCallback((e: React.DragEvent<HTMLDivElement>): void => {
    if (!allowAttachments || !dragHasFiles(e.dataTransfer)) return;
    e.preventDefault();
    dragDepth.current += 1;
    setDragActive(true);
  }, [allowAttachments]);

  const onDragOver = useCallback((e: React.DragEvent<HTMLDivElement>): void => {
    if (!allowAttachments || !dragHasFiles(e.dataTransfer)) return;
    // Without this the browser takes the drop itself and navigates away to the file, losing the
    // composer's text. This is the one call that makes the composer a real drop target (VS-277).
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  }, [allowAttachments]);

  const onDragLeave = useCallback((e: React.DragEvent<HTMLDivElement>): void => {
    if (!allowAttachments || !dragHasFiles(e.dataTransfer)) return;
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDragActive(false);
  }, [allowAttachments]);

  const onDrop = useCallback((e: React.DragEvent<HTMLDivElement>): void => {
    if (!allowAttachments || !dragHasFiles(e.dataTransfer)) return;
    e.preventDefault();
    clearDrag();
    // The same funnel browse and paste call, so types, cap and both error messages cannot drift.
    addFiles(Array.from(e.dataTransfer.files));
  }, [allowAttachments, addFiles, clearDrag]);

  // The composer is only 40px tall when idle, and a file dropped anywhere else would be handled by
  // the browser, which navigates to it and unloads the app. This window guard refuses that default
  // for file drags across the whole app (allowAttachments only); it never attaches or highlights —
  // the composer does that. Non-file drags are left untouched so a dragged link still works.
  useEffect(() => {
    if (!allowAttachments) return;
    const refuseDefault = (e: DragEvent): void => {
      if (dragHasFiles(e.dataTransfer)) e.preventDefault();
    };
    const onWindowDrop = (e: DragEvent): void => {
      if (!dragHasFiles(e.dataTransfer)) return;
      e.preventDefault();
      clearDrag();
    };
    window.addEventListener('dragover', refuseDefault);
    window.addEventListener('drop', onWindowDrop);
    return () => {
      window.removeEventListener('dragover', refuseDefault);
      window.removeEventListener('drop', onWindowDrop);
    };
  }, [allowAttachments, clearDrag]);

  const dictating = dictation.listening;
  // Only the non-streaming (upload/Voxtype) backend has anything to lock for: Chrome hands words
  // back live, so there is nothing stale on screen to protect (VS-195).
  const transcribing = dictation.mode === 'upload' && dictation.transcribing;
  const locked = dictation.mode === 'upload' && (dictating || transcribing);
  // `locked` covers text entry and attaching only. Sending is deliberately not locked by it: on the
  // non-streaming backend it is the one control that finishes the dictation (VS-282), so it stays
  // available throughout and is disabled only while a send is pending or in flight.
  const canSend = Boolean(text.trim()) || locked;

  return (
    <div className={cx('flex flex-col gap-1.5', className)}>
      {queuedReason ? (
        <div className="flex items-center gap-2 rounded-t-r8 border border-line-2 border-b-0 bg-bg-2 px-3 py-2">
          <StatusGlyph status="working" size="xs" />
          <span className="text-micro text-text-2">{queuedReason}</span>
          {queuedCount > 0 ? <span className="ac-mono ml-auto rounded-r4 bg-bg-3 px-1.5 py-0.5 text-micro text-text-3">{queuedCount} queued</span> : null}
        </div>
      ) : null}
      {scope ? <div className="text-micro text-text-3">{scope}</div> : null}

      <div
        data-testid="composer-drop-zone"
        onDragEnter={onDragEnter}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        className={cx(
          'rounded-r8 border bg-bg-1 transition-colors duration-(--dur-fast) ease-ac',
          queuedReason && 'rounded-t-none',
          // No focus ring: the caret says it all. The border changes while the mic is open — and,
          // for a non-streaming backend, while its transcript is still in flight — and while a file
          // is dragged over the composer, so both read as one continuous state rather than
          // flickering back mid-attempt. Drop reuses the same active-border language as the mic
          // (VS-277).
          dictating || transcribing || dragActive ? 'border-accent' : 'border-line-2',
        )}
      >
        {allowAttachments && files.length > 0 ? (
          <ul className="flex flex-wrap gap-1.5 px-3.5 pt-2" aria-label="Attached files">
            {files.map((f, i) => (
              <li key={`${f.name}-${i}`} className="flex items-center gap-1.5 rounded-r6 border border-line-2 bg-bg-2 py-1 pl-2 pr-1 text-micro text-text-2">
                <span className="max-w-40 truncate">{f.name}</span>
                  <button
                    type="button"
                    aria-label={`Remove ${f.name}`}
                    disabled={submitting}
                    onClick={() => removeFile(i)}
                    className="inline-flex size-4 items-center justify-center rounded-full text-text-4 hover:bg-bg-3 hover:text-text-1"
                  >
                  ×
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        <div className="flex items-end gap-2.5 p-2 pl-3.5">
          <textarea
            ref={ta}
            rows={rows}
            value={text}
            disabled={disabled || submitting || locked}
            placeholder={placeholder}
            aria-label={placeholder}
            onChange={(e) => set(e.target.value)}
            onPaste={onPaste}
            // Enter sends only where there is a modifier to hold for a newline. On touch the key is
            // left entirely to the browser, so the textarea's own undo, IME composition and autosize
            // keep working — inserting the '\n' by hand breaks all three (VS-89).
            enterKeyHint={isTouch ? 'enter' : undefined}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !isTouch) {
                e.preventDefault();
                send();
              }
            }}
            className="max-h-[min(12rem,calc(var(--ac-app-h)*0.35))] flex-1 resize-none overflow-y-auto bg-transparent py-1.5 text-body text-text-1 outline-none placeholder:text-text-4 focus-visible:[box-shadow:none]"
          />
          {allowAttachments ? (
            <>
              <input
                ref={fileInput}
                type="file"
                multiple
                accept={ACCEPT_ATTR}
                data-testid="composer-file-input"
                className="hidden"
                onChange={(e) => {
                  addFiles(Array.from(e.target.files ?? []));
                  e.target.value = '';
                }}
              />
              <button
                type="button"
                aria-label="Attach a file"
                disabled={disabled || submitting || locked}
                onClick={() => fileInput.current?.click()}
                className="inline-flex size-8 flex-none items-center justify-center rounded-r6 border border-line-2 text-text-2 transition-colors duration-(--dur-fast) ease-ac hover:bg-bg-3 hover:text-text-1"
              >
                <AttachIcon />
              </button>
            </>
          ) : null}
          <button
            type="button"
            aria-label={dictation.mode === 'unavailable' ? 'Dictation unavailable' : dictating ? 'Stop dictation' : transcribing ? 'Transcribing' : 'Dictate'}
            aria-pressed={dictating}
            // Stopping stays available throughout recording; once stopped, there is nothing left
            // to stop, and starting a second recording before this one's transcript lands is not a
            // state the hook holds concurrently (VS-195).
            disabled={transcribing}
            onClick={() => { startedByKey.current = false; dictating ? dictation.stop() : startMic(); }}
            className={cx(
              'inline-flex size-8 flex-none items-center justify-center rounded-r6 border transition-colors duration-(--dur-fast) ease-ac',
              dictating
                ? 'border-accent bg-accent-tint-strong text-accent-link'
                : transcribing
                  ? 'border-accent text-accent-link opacity-60'
                  : dictation.mode === 'unavailable'
                    ? 'border-line-2 text-text-4'
                    : 'border-line-2 text-text-2 hover:bg-bg-3 hover:text-text-1',
            )}
          >
            <MicIcon slashed={dictation.mode === 'unavailable'} />
          </button>
          <button
            type="button"
            aria-label={pendingSend ? 'Send queued' : submitLabel}
            disabled={!canSend || disabled || submitting || pendingSend}
            onClick={send}
            className={cx(
              'inline-flex size-8 flex-none items-center justify-center rounded-r6 transition-colors duration-(--dur-fast) ease-ac',
              pendingSend
                ? 'border border-accent text-accent-link opacity-60'
                : canSend && !disabled && !submitting ? 'bg-accent text-accent-on' : 'bg-bg-3 text-text-4',
            )}
          >
            {pendingSend ? (
              <span className="size-3 animate-spin rounded-pill border border-current border-t-transparent" aria-hidden />
            ) : (
              <SendIcon />
            )}
          </button>
        </div>

        {dictating ? (
          <div className="flex h-12 items-center gap-3 border-t border-line-1 px-3.5">
            {/* fixed-height row: the waveform moves, the box never does */}
            {dictation.metered ? (
              <VoiceMeter analyser={dictation.analyser} active={dictating} className="h-8 min-w-0 flex-1" />
            ) : (
              // The Web Speech API owns the mic and hands out no stream, so there is nothing to
              // meter; the waveform that used to sit here read a second capture of our own, which
              // is exactly what starved the recognizer on mobile (VS-25).
              <span className="flex h-8 min-w-0 flex-1 items-center gap-2 text-micro text-text-3">
                <span className="size-1.5 flex-none animate-pulse rounded-full bg-accent" aria-hidden />
                Listening…
              </span>
            )}
            <span className="ac-mono text-micro tabular-nums text-text-3">
              {Math.floor(dictation.elapsed / 60)}:{String(dictation.elapsed % 60).padStart(2, '0')}
            </span>
            <span className="hidden text-micro text-text-4 sm:inline">{isTouch ? 'tap the mic to stop' : startedByKey.current ? 'release ⌘⇧M to stop' : 'click the mic to stop'}</span>
          </div>
        ) : transcribing ? (
          // Distinct from the listening row above: the mic is closed, nothing is being captured
          // any more, and there is nothing left to stop — only a spinner until the transcript
          // lands or the attempt fails (VS-195).
          <div className="flex h-12 items-center gap-3 border-t border-line-1 px-3.5">
            <span className="flex h-8 min-w-0 flex-1 items-center gap-2 text-micro text-text-3">
              <span className="size-2.5 flex-none animate-spin rounded-pill border border-current border-t-transparent text-accent-link" aria-hidden />
              Transcribing…
            </span>
          </div>
        ) : null}
        {dictating && dictation.mode === 'upload' ? (
          // Not hidden below a breakpoint like the hint above: a non-streaming backend's "silence
          // on screen doesn't mean it failed" message matters most on a phone.
          <p className="border-t border-line-1 px-3.5 py-1.5 text-micro text-text-3">
            Recording — this is transcribed once you stop; press send to finish and send it.
          </p>
        ) : null}
      </div>

      {dictation.error ? (
        <p className="rounded-r6 border border-blocked/35 bg-blocked/8 px-3 py-2 text-micro leading-relaxed text-text-1" role="alert">
          {dictation.error}
        </p>
      ) : null}
      {pendingSend ? (
        <p className="flex items-center gap-2 text-micro text-text-2" role="status" aria-live="polite">
          <span className="size-2.5 animate-spin rounded-pill border border-current border-t-transparent" aria-hidden />
          Waiting for the transcript — this sends as soon as it lands.
        </p>
      ) : null}
      {pendingNotice && !dictation.error ? (
        <p className="rounded-r6 border border-blocked/35 bg-blocked/8 px-3 py-2 text-micro leading-relaxed text-text-1" role="alert">
          {pendingNotice}
        </p>
      ) : null}
      {attachError ? (
        <p className="rounded-r6 border border-blocked/35 bg-blocked/8 px-3 py-2 text-micro leading-relaxed text-text-1" role="alert">
          {attachError}
        </p>
      ) : null}
      {submitting ? (
        <p className="flex items-center gap-2 text-micro text-text-2" role="status" aria-live="polite">
          <span className="size-2.5 animate-spin rounded-pill border border-current border-t-transparent" aria-hidden />
          {inFlightLabel.current}
        </p>
      ) : null}
      {submitFailed && !submitting ? (
        <p className="rounded-r6 border border-blocked/35 bg-blocked/8 px-3 py-2 text-micro leading-relaxed text-text-1" role="alert">
          Message not sent — retry when you are ready.
        </p>
      ) : null}
      {explain && dictation.mode === 'unavailable' ? (
        <p className="text-micro leading-relaxed text-text-3">
          Dictation is unavailable: this browser has no Web Speech API and the daemon has no transcription provider.{' '}
          <span className="text-accent-link">Set a provider in Settings → Conductor</span>, or type instead.
        </p>
      ) : null}
      {dictation.diagnostics.enabled && dictation.diagnostics.count > 0 ? (
        <button
          type="button"
          onClick={() => {
            dictation.diagnostics.copy();
            setDiagnosticsCopied(true);
            setTimeout(() => setDiagnosticsCopied(false), 2000);
          }}
          className="self-start text-micro text-accent-link hover:underline"
        >
          {diagnosticsCopied ? 'Copied' : `Copy dictation diagnostics (${dictation.diagnostics.count} event${dictation.diagnostics.count === 1 ? '' : 's'})`}
        </button>
      ) : null}
    </div>
  );
}
