/**
 * The V2 chat composer (web-v2/chat-composer).
 *
 * Three identical controls — attach, dictate, send — on the raised surface with 6px corners, a
 * project scope selector above them, and the kept V1 behaviours: dictation (through the shared
 * `useDictation` hook, metered by `VoiceMeter` in V2's accent), attachments through picker/paste/drag,
 * and a search affordance. The draft itself is owned by the screen (`lib/drafts`), so this component
 * is controlled.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Project } from '@weave-ai/shared';
import { ATTACHMENT_IMAGE_TYPES, ATTACHMENT_MAX_PER_MESSAGE, ATTACHMENT_TEXT_TYPES } from '@weave-ai/shared';
import { projectLabel } from '@weave-ai/shared';
import { useDictation } from '../lib/dictation';
import { useDictationHotkey } from '../lib/dictationHotkey';
import { useDictationAutoSend } from '../lib/dictationAutoSend';
import { dictationHint } from '../lib/dictationHint';
import { projectColorVar } from '../lib/projectColor';
import { REVEAL_MS, REVEAL_STEP_MS, revealedCount, usePrefersReducedMotion } from '../lib/streamReveal';
import { VoiceMeter } from '../components/VoiceMeter';
import { cx } from '../lib/cx';

const ACCEPTED = [...ATTACHMENT_IMAGE_TYPES, ...ATTACHMENT_TEXT_TYPES] as readonly string[];
const ACCEPT_ATTR = ACCEPTED.join(',');
const MAX_INPUT_PX = 192;

function dragHasFiles(dt: DataTransfer | null): boolean {
  return Array.from(dt?.types ?? []).includes('Files');
}

function AttachIcon(): React.ReactElement {
  return (
    <svg viewBox="0 0 16 16" className="size-3.5" aria-hidden>
      <path d="M11 4.5v6a3 3 0 0 1-6 0V4a2 2 0 0 1 4 0v5.5a1 1 0 0 1-2 0V5" stroke="currentColor" strokeWidth="1.3" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function MicIcon({ slashed }: { slashed?: boolean }): React.ReactElement {
  return (
    <svg viewBox="0 0 16 16" className="size-3.5" aria-hidden>
      <rect x="5.6" y="1.4" width="4.8" height="8.2" rx="2.4" fill="currentColor" />
      <path d="M3.4 7.4a4.6 4.6 0 0 0 9.2 0M8 12v2.6" stroke="currentColor" strokeWidth="1.3" fill="none" strokeLinecap="round" />
      {slashed ? <path d="M2.2 2.2 13.8 13.8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /> : null}
    </svg>
  );
}

function SendIcon(): React.ReactElement {
  return (
    <svg viewBox="0 0 12 12" className="size-3.5" aria-hidden>
      <path d="M0 0 L12 6 L0 12 L2.6 6 Z" fill="currentColor" />
    </svg>
  );
}

function StopIcon(): React.ReactElement {
  return (
    <svg viewBox="0 0 12 12" className="size-3.5" aria-hidden>
      <rect x="2.5" y="2.5" width="7" height="7" rx="1.4" fill="currentColor" />
    </svg>
  );
}

const BUTTON = 'flex size-7 flex-none items-center justify-center rounded-[6px] border border-line-2 bg-bg-2 text-text-2 hover:bg-bg-3 hover:text-text-1 disabled:cursor-not-allowed disabled:opacity-55';

export interface ChatComposerProps {
  projects: Project[];
  projectId: string | null;
  onChangeProject: (id: string | null) => void;
  value: string;
  onChange: (text: string) => void;
  replyToExcerpt?: string | null;
  replyToMessageId?: string | null;
  onDismissReply?: () => void;
  onSubmit: (text: string, files: File[], opts: { projectId: string | null; replyToMessageId: string | null; idempotencyKey: string }) => void | Promise<void>;
  /** The search and plan affordances are chat-only; each button hides when its handler is absent (the plan modal passes neither). */
  onOpenSearch?: () => void;
  onOpenPlan?: () => void;
  /** The project scope selector is chat-only; the plan modal is already bound to one project and hides it. */
  showScope?: boolean;
  /** The input's placeholder and accessible name; default to the weaver chat's wording. */
  placeholder?: string;
  ariaLabel?: string;
  /** Whether this composer answers the global push-to-talk hotkey; the plan modal and the chat behind it must not both listen (VS-428). */
  hotkey?: boolean;
  disabled?: boolean;
  queuedReason?: string | null;
  queuedCount?: number;
}

export function ChatComposer({
  projects,
  projectId,
  onChangeProject,
  value,
  onChange,
  replyToExcerpt,
  replyToMessageId = null,
  onDismissReply,
  onSubmit,
  onOpenSearch,
  onOpenPlan,
  showScope = true,
  placeholder = 'Message the weaver…',
  ariaLabel = 'Message the weaver',
  hotkey = true,
  disabled,
  queuedReason,
  queuedCount = 0,
}: ChatComposerProps): React.ReactElement {
  const ta = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [attachError, setAttachError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const dragDepth = useRef(0);
  const [freeText, setFreeText] = useState(false);
  const [pendingNotice, setPendingNotice] = useState<string | null>(null);
  const [pendingSend, setPendingSend] = useState(false);
  const pendingSendRef = useRef(false);
  const base = useRef('');
  /** Set by the dictation callback; consumed by the layout effect so an insert scrolls to its end. */
  const dictated = useRef(false);
  const reducedMotion = usePrefersReducedMotion();
  /**
   * A dictated insert reveals over a few frames (VS-425): the draft is committed in full at once, so
   * a queued send still gets the last words, while the textarea shows a growing prefix of it. `null`
   * when nothing is revealing.
   */
  const [reveal, setReveal] = useState<{ prefix: string; piece: string; shown: number } | null>(null);
  const revealTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopReveal = useCallback((): void => {
    if (revealTimer.current !== null) clearInterval(revealTimer.current);
    revealTimer.current = null;
    setReveal(null);
  }, []);
  useEffect(() => stopReveal, [stopReveal]);

  /** What the textarea shows: the committed draft, or a growing prefix of a revealing dictated insert. */
  const displayed = reveal ? `${reveal.prefix}${reveal.piece.slice(0, reveal.shown)}` : value;

  // A send (which clears the draft) or any other change to the committed draft ends the reveal: the
  // textarea must never stay pinned to the text that was streaming in once the draft it belonged to
  // has moved on, or typing would write that stale text back (VS-425).
  useEffect(() => {
    if (reveal && value !== `${reveal.prefix}${reveal.piece}`) stopReveal();
  }, [value, reveal, stopReveal]);

  const isTouch = typeof window !== 'undefined' && window.matchMedia('(hover: none)').matches;
  // Opt-in, per browser (VS-435): a session that ends sends the settled draft, through the same
  // queued path the send arrow uses.
  const autoSend = useDictationAutoSend();

  const dictation = useDictation((transcript, final) => {
    const piece = transcript.trim();
    if (!piece) return;
    const joiner = base.current && !base.current.endsWith(' ') ? ' ' : '';
    const full = `${base.current}${joiner}${piece}`;
    // Commit the whole draft immediately: the reveal is display only, so a send queued while
    // dictating submits every last word (VS-416), not the prefix on screen mid-animation.
    onChange(full);
    if (!final || reducedMotion || typeof setInterval !== 'function') {
      stopReveal();
      return;
    }
    stopReveal();
    const prefix = `${base.current}${joiner}`;
    let step = 0;
    const total = Math.max(1, Math.ceil(REVEAL_MS / REVEAL_STEP_MS));
    dictated.current = true;
    setReveal({ prefix, piece, shown: 0 });
    revealTimer.current = setInterval(() => {
      step += 1;
      dictated.current = true;
      if (step >= total) {
        // The reveal is over: drop it, so `displayed` follows the committed draft from here on.
        if (revealTimer.current !== null) clearInterval(revealTimer.current);
        revealTimer.current = null;
        setReveal(null);
      } else {
        setReveal({ prefix, piece, shown: revealedCount(piece.length, step * REVEAL_STEP_MS, REVEAL_MS) });
      }
    }, REVEAL_STEP_MS);
  });

  const startMic = useCallback(() => {
    base.current = value;
    dictation.start();
  }, [dictation, value]);

  // Every way a session ends — the hotkey's release or toggle-off, and the mic button — routes
  // through here. With the setting on, it arms the existing queued send before stopping, so the
  // transcript goes out through the same path as a queued arrow press. `send()` keeps the raw
  // `dictation.stop` so a manual send is never armed twice (VS-435).
  const stopDictation = useCallback(() => {
    if (autoSend && !disabled && !submittingRef.current && !pendingSendRef.current) {
      pendingSendRef.current = true;
      setPendingSend(true);
    }
    dictation.stop();
  }, [autoSend, disabled, dictation]);

  // The shared dictation chord: a quick press toggles, a hold is push-to-talk (VS-432). A touch
  // device, a disabled composer, or one that has handed the hotkey to a modal (VS-428) does not
  // claim it.
  useDictationHotkey({
    enabled: !isTouch && hotkey && !disabled,
    listening: dictation.listening,
    start: startMic,
    stop: stopDictation,
  });

  // Grow to fit, then scroll inside. Measuring collapses the box and throws the scroll position
  // away, so it is put back: at the end when the insert came from dictation or the caret is already
  // there, otherwise where the browser left it. A dictated insert also moves the caret to the end,
  // which is what "the newest text is visible" means for a long transcript (VS-416). While
  // listening there is no textarea — the flag survives until it returns, so the remount scrolls.
  // The reveal shifts the textarea's value a frame at a time, so this runs on the displayed text,
  // not the committed draft, and follows the animation to its end.
  useLayoutEffect(() => {
    const el = ta.current;
    if (!el) return;
    const fromDictation = dictated.current;
    dictated.current = false;
    const atEnd = fromDictation || (el.selectionStart === el.value.length && el.selectionEnd === el.value.length);
    const prev = el.scrollTop;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, MAX_INPUT_PX)}px`;
    if (fromDictation) el.setSelectionRange(el.value.length, el.value.length);
    el.scrollTop = atEnd ? el.scrollHeight : prev;
  }, [displayed, dictation.listening, dictation.transcribing]);

  const addFiles = useCallback((incoming: File[]): void => {
    const accepted = incoming.filter((f) => ACCEPTED.includes(f.type));
    if (accepted.length < incoming.length) setAttachError('Only images (PNG/JPEG/GIF/WebP) and plain text/markdown files are accepted.');
    else setAttachError(null);
    setFiles((cur) => [...cur, ...accepted].slice(0, ATTACHMENT_MAX_PER_MESSAGE));
  }, []);

  const doSubmit = useCallback((t: string): void => {
    if (disabled || submittingRef.current) return;
    submittingRef.current = true;
    setSubmitting(true);
    setSubmitError(null);
    const idempotencyKey = crypto.randomUUID();
    Promise.resolve(onSubmit(t, files, { projectId, replyToMessageId, idempotencyKey }))
      .then(() => {
        setFiles([]);
        setAttachError(null);
      })
      .catch((e: unknown) => {
        // The draft and the files stay for a retry; the failure has to be visible, not silent.
        setSubmitError(e instanceof Error && e.message ? e.message : 'Message not sent — retry when you are ready.');
      })
      .finally(() => {
        submittingRef.current = false;
        setSubmitting(false);
      });
  }, [disabled, files, onSubmit, projectId, replyToMessageId]);

  const send = useCallback((): void => {
    if (disabled || submittingRef.current) return;
    setPendingNotice(null);
    // Send means "finish the dictation and send it". The transcript lands only after `stop()` —
    // synchronously-late for Web Speech, as a daemon response for Voxtype — so the send queues and
    // the effect below submits once the attempt has settled, with whatever text landed. A second
    // press while queued is a no-op, and an empty result submits nothing (V1's pendingSend, VS-282).
    if (dictation.listening || dictation.transcribing) {
      if (pendingSendRef.current) return;
      pendingSendRef.current = true;
      setPendingSend(true);
      if (dictation.listening) dictation.stop();
      return;
    }
    const t = value.trim();
    if (!t && files.length === 0) return;
    doSubmit(t);
  }, [disabled, value, files, dictation, doSubmit]);

  // A queued send submits when the attempt settles; reading `value` here — not a value captured at
  // press time — keeps the transcript that landed (VS-282). A failed or empty transcript submits
  // nothing, so an empty body is never sent mid-dictation (VS-416).
  useEffect(() => {
    if (!pendingSend || !dictation.settled) return;
    pendingSendRef.current = false;
    setPendingSend(false);
    // An auto-armed send (VS-435) must go out only while the composer can still send: if it was
    // disabled or is already submitting, drop it rather than submit behind the human's back.
    if (disabled || submittingRef.current) return;
    if (dictation.error) return;
    const t = value.trim();
    if (!t && files.length === 0) {
      setPendingNotice('Nothing was recognized, so nothing was sent.');
      return;
    }
    doSubmit(t);
  }, [pendingSend, dictation.settled, dictation.error, disabled, value, files.length, doSubmit]);

  const onPaste = useCallback((e: React.ClipboardEvent<HTMLTextAreaElement>): void => {
    const pasted = Array.from(e.clipboardData?.items ?? [])
      .filter((i) => i.kind === 'file')
      .map((i) => i.getAsFile())
      .filter((f): f is File => f !== null);
    if (pasted.length === 0) return;
    e.preventDefault();
    addFiles(pasted);
  }, [addFiles]);

  const siblings = projects.map((p) => p.id);

  return (
    <div className="flex flex-col gap-2">
      {queuedReason ? (
        <div className="flex items-center gap-2 rounded-r4 border border-line-1 bg-bg-2 px-2.5 py-1.5">
          <span className="size-1.5 flex-none rounded-pill bg-working" aria-hidden />
          <span className="text-micro text-text-2">{queuedReason}</span>
          {queuedCount > 0 ? <span className="ac-mono ml-auto text-nano text-text-3">{queuedCount} queued</span> : null}
        </div>
      ) : null}

      <div className="flex items-center gap-1.5 overflow-x-auto">
        {onOpenSearch ? (
          <button type="button" onClick={onOpenSearch} aria-label="Search this conversation" className="v2-tag flex-none text-text-3 hover:text-text-1">
            ⌕ Search
          </button>
        ) : null}
        {onOpenPlan ? (
          <button type="button" onClick={onOpenPlan} aria-label="Plan a body of work interactively" className="v2-tag flex-none text-text-3 hover:text-text-1">
            Plan
          </button>
        ) : null}
        {showScope ? (
          <>
            {onOpenSearch || onOpenPlan ? <span className="mx-0.5 h-3 w-px flex-none bg-line-2" aria-hidden /> : null}
            <button
              type="button"
              onClick={() => onChangeProject(null)}
              aria-pressed={projectId === null}
              className={cx('v2-tag flex-none', projectId === null ? 'bg-bg-3 text-text-1' : 'text-text-2')}
            >
              Auto
            </button>
            {projects.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => onChangeProject(p.id === projectId ? null : p.id)}
                aria-pressed={p.id === projectId}
                style={{ color: projectColorVar(p.id, siblings) }}
                className={cx('v2-tag flex-none', p.id === projectId ? 'bg-bg-3' : '')}
              >
                {projectLabel(p)}
              </button>
            ))}
          </>
        ) : null}
        <span className="ac-mono ml-auto flex-none whitespace-nowrap text-nano text-text-3">{dictationHint({ isTouch })}</span>
      </div>

      {replyToExcerpt ? (
        <div className="flex items-start gap-2 rounded-r4 border-l-2 border-accent bg-bg-2 py-1 pl-2 pr-1">
          <span className="min-w-0 flex-1">
            <span className="block text-nano text-text-4">Replying to the weaver</span>
            <span className="line-clamp-2 block text-micro text-text-2">{replyToExcerpt}</span>
          </span>
          <button type="button" aria-label="Dismiss reply" onClick={onDismissReply} className="flex-none px-1.5 text-micro text-text-3 hover:text-text-1">×</button>
        </div>
      ) : null}

      {files.length > 0 ? (
        <ul className="flex flex-wrap gap-1.5" aria-label="Attached files">
          {files.map((f, i) => (
            <li key={`${f.name}-${i}`} className="flex items-center gap-1.5 rounded-r4 border border-line-1 bg-bg-2 py-0.5 pl-2 pr-1 text-micro text-text-2">
              <span className="max-w-40 truncate">{f.name}</span>
              <button type="button" aria-label={`Remove ${f.name}`} onClick={() => setFiles((cur) => cur.filter((_, idx) => idx !== i))} className="text-text-4 hover:text-text-1">×</button>
            </li>
          ))}
        </ul>
      ) : null}

      <div
        data-testid="v2-composer"
        onDragEnter={(e) => { if (dragHasFiles(e.dataTransfer)) { e.preventDefault(); dragDepth.current += 1; setDragActive(true); } }}
        onDragOver={(e) => { if (dragHasFiles(e.dataTransfer)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } }}
        onDragLeave={(e) => { if (dragHasFiles(e.dataTransfer)) { dragDepth.current = Math.max(0, dragDepth.current - 1); if (dragDepth.current === 0) setDragActive(false); } }}
        onDrop={(e) => { if (!dragHasFiles(e.dataTransfer)) return; e.preventDefault(); dragDepth.current = 0; setDragActive(false); addFiles(Array.from(e.dataTransfer.files)); }}
        className={cx('flex items-end gap-2 rounded-r4 border bg-bg-input px-2.5 py-1.5', dragActive || dictation.listening ? 'border-accent' : 'border-line-2')}
      >
        {dictation.listening ? (
          <div data-testid="v2-composer-listening" className="flex min-w-0 flex-1 items-center gap-2.5 py-1">
            {dictation.metered ? (
              <VoiceMeter analyser={dictation.analyser} active className="h-6 min-w-0 flex-1" />
            ) : (
              <span className="flex h-6 min-w-0 flex-1 items-center gap-2 text-micro text-text-3">
                <span className="size-1.5 flex-none animate-pulse rounded-full bg-accent-link" aria-hidden />
                Listening…
              </span>
            )}
            <span className="ac-mono flex-none text-nano tabular-nums text-text-3">
              {Math.floor(dictation.elapsed / 60)}:{String(dictation.elapsed % 60).padStart(2, '0')}
            </span>
          </div>
        ) : (
          <textarea
            ref={ta}
            rows={1}
            value={displayed}
            disabled={disabled || submitting}
            placeholder={placeholder}
            aria-label={ariaLabel}
            onChange={(e) => { stopReveal(); onChange(e.target.value); }}
            onPaste={onPaste}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !isTouch) { e.preventDefault(); send(); } }}
            className="max-h-[12rem] flex-1 resize-none overflow-y-auto bg-transparent py-1 text-body text-text-1 outline-none placeholder:text-text-4 focus-visible:[box-shadow:none]"
          />
        )}
        <input
          ref={fileInput}
          type="file"
          multiple
          accept={ACCEPT_ATTR}
          data-testid="v2-composer-file-input"
          className="hidden"
          onChange={(e) => { addFiles(Array.from(e.target.files ?? [])); e.target.value = ''; }}
        />
        <button type="button" className={BUTTON} aria-label="Attach a file" disabled={disabled || submitting} onClick={() => fileInput.current?.click()}>
          <AttachIcon />
        </button>
        <button
          type="button"
          className={cx(BUTTON, dictation.listening && 'border-accent text-accent-link')}
          aria-label={dictation.mode === 'unavailable' ? 'Dictation unavailable' : dictation.listening ? 'Stop dictation' : 'Dictate'}
          aria-pressed={dictation.listening}
          onClick={() => { if (dictation.listening) stopDictation(); else if (dictation.mode === 'unavailable') { setFreeText(true); setPendingNotice('Dictation is unavailable: this browser has no Web Speech API and the daemon has no transcription provider.'); } else startMic(); }}
        >
          {dictation.listening ? <StopIcon /> : <MicIcon slashed={dictation.mode === 'unavailable'} />}
        </button>
        <button
          type="button"
          className={cx(BUTTON, pendingSend && 'border-accent text-accent-link')}
          aria-label={pendingSend ? 'Send queued' : 'Send'}
          disabled={disabled || submitting || pendingSend || (!value.trim() && files.length === 0 && !dictation.listening && !dictation.transcribing)}
          onClick={send}
        >
          {pendingSend ? (
            <span className="size-3.5 animate-spin rounded-pill border border-current border-t-transparent" aria-hidden />
          ) : (
            <SendIcon />
          )}
        </button>
      </div>

      {dictation.error ? <p role="alert" className="rounded-r4 border border-blocked/35 px-3 py-2 text-micro text-text-1">{dictation.error}</p> : null}
      {pendingNotice && !dictation.error ? <p role="status" className="rounded-r4 border border-line-1 px-3 py-2 text-micro text-text-3">{pendingNotice}</p> : null}
      {freeText && dictation.error ? (
        <p className="text-micro text-text-3">Type instead, or set a provider in Settings → Dictation.</p>
      ) : null}
      {attachError ? <p role="alert" className="rounded-r4 border border-blocked/35 px-3 py-2 text-micro text-text-1">{attachError}</p> : null}
      {submitError ? <p role="alert" className="rounded-r4 border border-blocked/35 px-3 py-2 text-micro text-text-1">{submitError}</p> : null}
      {submitting ? <p role="status" className="text-micro text-text-3">{files.length > 0 ? 'Uploading and sending…' : 'Sending…'}</p> : null}
    </div>
  );
}
