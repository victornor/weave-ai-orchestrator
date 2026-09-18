/**
 * The V2 chat composer (web-v2/chat-composer).
 *
 * Three identical controls — attach, dictate, send — on the raised surface with 6px corners, a
 * project scope selector above them, and the kept V1 behaviours: dictation through the shared
 * `useDictationController`, metered by `VoiceMeter` in V2's accent, attachments through
 * picker/paste/drag, and a search affordance. The draft itself is owned by the screen
 * (`lib/drafts`), so this component is controlled.
 *
 * VS-450: when a `DictationSessionProvider` is above it and this composer is the chat the session
 * belongs to, the dictation state comes from that shared session, so a dictation survives navigating
 * away and back. A composer that opts out (the Plan modal) or has no provider (V1, tests) keeps its
 * own local session exactly as before.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Project } from '@weave-ai/shared';
import { ATTACHMENT_IMAGE_TYPES, ATTACHMENT_MAX_PER_MESSAGE, ATTACHMENT_TEXT_TYPES } from '@weave-ai/shared';
import { projectLabel } from '@weave-ai/shared';
import { useDictationController, type DictationController } from '../lib/dictationController';
import { useDictationHotkey } from '../lib/dictationHotkey';
import { dictationHint } from '../lib/dictationHint';
import { projectColorVar } from '../lib/projectColor';
import { usePrefersReducedMotion } from '../lib/streamReveal';
import { DictationAlerts, DictationButton, DictationProgress } from './DictationControl';
import { useDictationSession, type ComposerRegistration, type DictationSessionValue, type DictationTarget } from './DictationSession';
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

function SendIcon(): React.ReactElement {
  return (
    <svg viewBox="0 0 12 12" className="size-3.5" aria-hidden>
      <path d="M0 0 L12 6 L0 12 L2.6 6 Z" fill="currentColor" />
    </svg>
  );
}

const BUTTON = 'flex size-7 flex-none items-center justify-center rounded-[6px] border border-line-2 bg-bg-2 text-text-2 hover:bg-bg-3 hover:text-text-1 disabled:cursor-not-allowed disabled:opacity-55';

export interface ChatComposerProps {
  projects: Project[];
  projectId: string | null;
  onChangeProject: (id: string | null) => void;
  /** The selected project's `open` roadmap blocks, offered once a project is chosen (VS-491). */
  blocks?: ReadonlyArray<{ id: string; title: string }>;
  blockId?: string | null;
  onChangeBlock?: (id: string | null) => void;
  value: string;
  onChange: (text: string) => void;
  replyToExcerpt?: string | null;
  replyToMessageId?: string | null;
  onDismissReply?: () => void;
  onSubmit: (text: string, files: File[], opts: { projectId: string | null; blockId: string | null; replyToMessageId: string | null; idempotencyKey: string }) => void | Promise<void>;
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
  /** The workspace and thread this composer belongs to; required to join the shared dictation session (VS-450). */
  dictationTarget?: DictationTarget | null;
  /** False to keep a local dictation session — the Plan modal does this (VS-450). */
  sharedDictation?: boolean;
  /** Whether this is the focused pane's composer. Only the focused pane may start or show dictation (VS-489). */
  focused?: boolean;
}

export function ChatComposer(props: ChatComposerProps): React.ReactElement {
  const session = useDictationSession();
  const shared = session && props.sharedDictation !== false ? session : null;
  return <ChatComposerBody {...props} shared={shared} />;
}

function ChatComposerBody({ shared, ...props }: ChatComposerProps & { shared: DictationSessionValue | null }): React.ReactElement {
  const {
    projects,
    projectId,
    onChangeProject,
    blocks = [],
    blockId = null,
    onChangeBlock,
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
    dictationTarget = null,
    focused = true,
  } = props;

  const ta = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const filesRef = useRef<File[]>([]);
  filesRef.current = files;
  const [attachError, setAttachError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const dragDepth = useRef(0);
  const [freeText, setFreeText] = useState(false);
  const [unavailableNotice, setUnavailableNotice] = useState<string | null>(null);
  const reducedMotion = usePrefersReducedMotion();
  const isTouch = typeof window !== 'undefined' && window.matchMedia('(hover: none)').matches;

  const doSubmitRef = useRef<(text: string) => void>(() => undefined);
  const local = useDictationController({
    value,
    writeValue: onChange,
    submit: (text) => doSubmitRef.current(text),
    canSubmit: () => !disabled && !submittingRef.current,
    hasFiles: () => filesRef.current.length > 0,
  });
  const ctl: DictationController = shared ?? local;

  // Whether the shared session is live in *this* composer. A local session always is; a shared one
  // only when it targets this thread, so a session running in another thread cannot paint its
  // transcript here.
  const isSessionTarget =
    shared !== null &&
    shared.target !== null &&
    dictationTarget !== null &&
    shared.target.ws === dictationTarget.ws &&
    shared.target.threadId === dictationTarget.threadId;
  const sessionHere = shared ? isSessionTarget && focused : true;
  // Only the focused pane shows or drives the shared session (VS-489): a non-focused pane's
  // composer must never paint the recording state or start a second session. While a session is
  // running for another pane, even the focused pane's control is inert — a second recording is
  // refused, not started.
  const dictationLocked = shared !== null && (!focused || (shared.active && !sessionHere));
  const reveal = sessionHere ? ctl.reveal : null;
  const dictation = ctl.dictation;
  const listeningHere = sessionHere && dictation.listening;
  const transcribingHere = sessionHere && dictation.transcribing;

  // The shared chord (VS-432): only a local composer binds it here — the provider owns it when the
  // session is shared. The chord's ending is the keybinding ending, which honours the auto-send
  // setting (VS-494); the mic button keeps the never-send `ctl.stop`.
  useDictationHotkey({
    enabled: !isTouch && hotkey && !disabled && shared === null,
    listening: dictation.listening,
    start: ctl.start,
    stop: ctl.stopByChord,
  });

  // Register as the place a shared hotkey-started session belongs, and as the submit path that can
  // carry attachments. The getter reads `regRef` so the registration object stays current without
  // re-subscribing on every render.
  const regRef = useRef<ComposerRegistration | null>(null);
  const registerComposer = shared?.registerComposer;
  useEffect(() => {
    if (!registerComposer || !focused) return;
    return registerComposer(() => regRef.current);
  }, [registerComposer, focused]);
  const setHotkeyAllowed = shared?.setHotkeyAllowed;
  useEffect(() => {
    if (!setHotkeyAllowed) return;
    setHotkeyAllowed(focused && hotkey && !disabled);
  }, [setHotkeyAllowed, focused, hotkey, disabled]);

  /** What the textarea shows: the committed draft, or a growing prefix of a revealing dictated insert. */
  const displayed = reveal ? `${reveal.prefix}${reveal.piece.slice(0, reveal.shown)}` : value;

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
    Promise.resolve(onSubmit(t, files, { projectId, blockId, replyToMessageId, idempotencyKey }))
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
  }, [disabled, files, onSubmit, projectId, blockId, replyToMessageId]);
  doSubmitRef.current = doSubmit;

  // Keep the provider's view of this composer current: its target, whether it may answer the chord,
  // what it has staged, and where a queued send should go.
  regRef.current = shared && dictationTarget && focused
    ? { target: dictationTarget, hotkeyAllowed: focused && hotkey && !disabled, disabled: Boolean(disabled), stagedFiles: files.length, submit: doSubmit }
    : null;

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
    const fromDictation = ctl.dictated.current;
    ctl.dictated.current = false;
    const atEnd = fromDictation || (el.selectionStart === el.value.length && el.selectionEnd === el.value.length);
    const prev = el.scrollTop;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, MAX_INPUT_PX)}px`;
    if (fromDictation) el.setSelectionRange(el.value.length, el.value.length);
    el.scrollTop = atEnd ? el.scrollHeight : prev;
  }, [displayed, dictation.listening, dictation.transcribing, ctl.dictated]);

  const onPaste = useCallback((e: React.ClipboardEvent<HTMLTextAreaElement>): void => {
    const pasted = Array.from(e.clipboardData?.items ?? [])
      .filter((i) => i.kind === 'file')
      .map((i) => i.getAsFile())
      .filter((f): f is File => f !== null);
    if (pasted.length === 0) return;
    e.preventDefault();
    addFiles(pasted);
  }, [addFiles]);

  // A typed send submits this composer's own draft, never the shared session's: the session's draft
  // is its target thread's and is empty until a session targets it, so routing a typed press there
  // was a silent no-op (VS-484). Only a dictation listening or transcribing *for this thread* keeps
  // its finish-and-send meaning through the shared controller.
  const localSend = local.requestSend;
  const sharedSend = shared?.requestSend;
  const send = useCallback((): void => {
    if (sessionHere && sharedSend && (dictation.listening || dictation.transcribing)) {
      sharedSend();
      return;
    }
    localSend();
  }, [sessionHere, sharedSend, dictation.listening, dictation.transcribing, localSend]);
  const pendingSend = ctl.pendingSend;

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
             Search
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

      {showScope && projectId && blocks.length > 0 ? (
        <div role="group" aria-label="Roadmap block for this message" className="flex items-center gap-1.5 overflow-x-auto">
          <button
            type="button"
            onClick={() => onChangeBlock?.(null)}
            aria-pressed={blockId === null}
            className={cx('v2-tag flex-none', blockId === null ? 'bg-bg-3 text-text-1' : 'text-text-2')}
          >
            Any block
          </button>
          {blocks.map((b) => (
            <button
              key={b.id}
              type="button"
              onClick={() => onChangeBlock?.(b.id === blockId ? null : b.id)}
              aria-pressed={b.id === blockId}
              className={cx('v2-tag flex-none', b.id === blockId ? 'bg-bg-3 text-text-1' : 'text-text-2')}
            >
              {b.title}
            </button>
          ))}
        </div>
      ) : null}

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
        className={cx('flex items-end gap-2 rounded-r4 border bg-bg-input px-2.5 py-1.5', dragActive || listeningHere || transcribingHere ? 'border-accent' : 'border-line-2')}
      >
        {listeningHere || transcribingHere ? (
          // The listening meter and the transcribing indicator share the input's slot, so the box
          // never flashes empty between stopping and the transcript landing (VS-441).
          <DictationProgress
            dictation={dictation}
            listening={listeningHere}
            transcribing={transcribingHere}
            reducedMotion={reducedMotion}
            testId="v2-composer"
          />
        ) : (
          <textarea
            ref={ta}
            rows={1}
            value={displayed}
            disabled={disabled || submitting}
            placeholder={placeholder}
            aria-label={ariaLabel}
            onChange={(e) => onChange(e.target.value)}
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
        <DictationButton
          dictation={dictation}
          listening={listeningHere}
          disabled={disabled || submitting || dictationLocked}
          onClick={() => { if (listeningHere) ctl.stop(); else if (dictation.mode === 'unavailable') { setFreeText(true); setUnavailableNotice('Dictation is unavailable: this browser has no Web Speech API and the daemon has no transcription provider.'); } else { setUnavailableNotice(null); ctl.start(); } }}
        />
        <button
          type="button"
          className={cx(BUTTON, pendingSend && 'border-accent text-accent-link')}
          aria-label={pendingSend ? 'Send queued' : 'Send'}
          disabled={disabled || submitting || pendingSend || (!value.trim() && files.length === 0 && !listeningHere && !transcribingHere)}
          onClick={send}
        >
          {pendingSend ? (
            <span className="size-3.5 animate-spin rounded-pill border border-current border-t-transparent" aria-hidden />
          ) : (
            <SendIcon />
          )}
        </button>
      </div>

      <DictationAlerts dictation={dictation} notice={ctl.pendingNotice ?? unavailableNotice} />
      {freeText && dictation.error ? (
        <p className="text-micro text-text-3">Type instead, or set a provider in Settings → Dictation.</p>
      ) : null}
      {attachError ? <p role="alert" className="rounded-r4 border border-blocked/35 px-3 py-2 text-micro text-text-1">{attachError}</p> : null}
      {submitError ? <p role="alert" className="rounded-r4 border border-blocked/35 px-3 py-2 text-micro text-text-1">{submitError}</p> : null}
      {submitting ? <p role="status" className="text-micro text-text-3">{files.length > 0 ? 'Uploading and sending…' : 'Sending…'}</p> : null}
    </div>
  );
}