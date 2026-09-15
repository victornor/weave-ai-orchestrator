/**
 * The V2 dictation session (VS-450), mounted once in `V2Shell` above the outlet so a dictation
 * started in the weaver chat keeps running when the human moves to another page, and can be
 * stopped or sent from the floating bar on any page.
 *
 * It owns the one `useDictation` instance through `useDictationController`, remembers the target the
 * session started against (workspace, weaver-chat thread, project scope, reply target), writes the
 * transcript into that thread's draft store, and binds the shared Ctrl/⌘+Shift+Space chord so it
 * controls the session from anywhere. A mounted `ChatComposer` registers itself as the place a
 * hotkey-started session belongs and as the submit path that can carry attachments; away from it the
 * session posts the draft to the target thread itself.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useRouterState } from '@tanstack/react-router';
import { api, NetworkError } from '../api/client';
import { qk } from '../api/keys';
import { useStreamQueryClient } from '../api/streams';
import { clearDraft, draftKey, patchDraft, useDraft } from '../lib/drafts';
import { enqueue } from '../lib/queue';
import { useDictationHotkey } from '../lib/dictationHotkey';
import { useDictationController, type DictationController } from '../lib/dictationController';
import { DictationBar } from './DictationBar';

export interface DictationTarget {
  ws: string;
  threadId: string;
  projectId: string | null;
  replyToMessageId: string | null;
}

/** What a mounted composer tells the session about itself, refreshed every render through a getter. */
export interface ComposerRegistration {
  target: DictationTarget;
  /** False while this composer has handed the chord to a modal (VS-428) or is disabled. */
  hotkeyAllowed: boolean;
  disabled: boolean;
  /** Attachments staged in the composer; they do not survive leaving the chat. */
  stagedFiles: number;
  submit: (text: string) => void | Promise<void>;
}

export interface DictationSessionValue extends DictationController {
  target: DictationTarget | null;
  /** Listening or transcribing — the session the bar exists to show and control. */
  active: boolean;
  /** The bar is on screen now; the shell reserves room for it so it never covers page content. */
  barVisible: boolean;
  /** Staged attachments that were lost when the composer left the chat (VS-450). */
  attachmentsDropped: number;
  /** The last send outcome, shown briefly on the page the human is on. */
  notice: string | null;
  /** A composer announces itself as the live target; the returned function detaches it. */
  registerComposer: (getter: () => ComposerRegistration | null) => () => void;
  setHotkeyAllowed: (allowed: boolean) => void;
  clearNotice: () => void;
}

const DictationSessionCtx = createContext<DictationSessionValue | null>(null);

/** The session, or null outside a `DictationSessionProvider` (V1, a bare composer, tests). */
export function useDictationSession(): DictationSessionValue | null {
  return useContext(DictationSessionCtx);
}

function sameTarget(a: DictationTarget | null, b: DictationTarget | null): boolean {
  return a !== null && b !== null && a.ws === b.ws && a.threadId === b.threadId;
}

export function DictationSessionProvider({ children }: { children: ReactNode }): React.ReactElement {
  const qc = useStreamQueryClient();
  const path = useRouterState({ select: (s) => s.location.pathname });
  const [target, setTarget] = useState<DictationTarget | null>(null);
  const [attachmentsDropped, setAttachmentsDropped] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [hotkeyAllowed, setHotkeyAllowedState] = useState(false);
  const composerGetter = useRef<(() => ComposerRegistration | null) | null>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const key = target ? draftKey(target.ws, `thread:${target.threadId}`) : null;
  const { draft } = useDraft(key);
  const value = draft.text;

  const showNotice = useCallback((text: string): void => {
    setNotice(text);
    if (noticeTimer.current !== null) clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(null), 5000);
  }, []);
  const clearNotice = useCallback((): void => {
    if (noticeTimer.current !== null) clearTimeout(noticeTimer.current);
    noticeTimer.current = null;
    setNotice(null);
  }, []);
  useEffect(() => () => { if (noticeTimer.current !== null) clearTimeout(noticeTimer.current); }, []);

  /** Post a text-only draft to the target thread, as the chat's send does (VS-282/VS-450). */
  const postToTarget = useCallback(async (to: DictationTarget, text: string): Promise<void> => {
    const body = {
      body: text,
      ...(to.projectId ? { projectId: to.projectId } : {}),
      ...(to.replyToMessageId ? { replyToMessageId: to.replyToMessageId } : {}),
      idempotencyKey: crypto.randomUUID(),
    };
    const queueThis = (): void => {
      enqueue({ kind: 'thread', path: `/threads/${to.threadId}/messages`, body, label: text.slice(0, 60) });
    };
    try {
      await api.ws(to.ws, `/threads/${to.threadId}/messages`, { method: 'POST', body });
      clearDraft(draftKey(to.ws, `thread:${to.threadId}`));
      void qc.invalidateQueries({ queryKey: qk.threadMessages(to.ws, to.threadId) });
      showNotice('Sent to the weaver');
    } catch (e) {
      if (e instanceof NetworkError) {
        queueThis();
        clearDraft(draftKey(to.ws, `thread:${to.threadId}`));
        showNotice('Offline — your message is queued');
        return;
      }
      showNotice(e instanceof Error && e.message ? e.message : 'Message not sent — retry when you are ready.');
    }
  }, [qc, showNotice]);

  const controller = useDictationController({
    value,
    writeValue: (text) => patchDraft(key, { text }),
    submit: (text) => {
      const c = composerGetter.current?.() ?? null;
      if (c && target && sameTarget(c.target, target)) return c.submit(text);
      return target ? postToTarget(target, text) : undefined;
    },
    canSubmit: () => {
      const c = composerGetter.current?.() ?? null;
      return c ? !c.disabled : true;
    },
    hasFiles: () => (composerGetter.current?.()?.stagedFiles ?? 0) > 0,
  });

  const [startToken, setStartToken] = useState(0);
  const startSession = useCallback((): void => {
    const c = composerGetter.current?.() ?? null;
    if (c && !c.disabled) setTarget(c.target);
    else if (!target) return;
    setStartToken((n) => n + 1);
  }, [target]);

  // Start after the target (and so `value`, the draft of the new target) has rendered, so `base` is
  // the right thread's draft.
  useEffect(() => {
    if (startToken === 0) return;
    controller.start();
    // `startToken` is the trigger; `controller.start` is intentionally read fresh here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startToken]);

  // The shared chord controls the session from any page (VS-432); on the target chat the composer
  // announces itself so the chord starts there, off-chat a live session is stopped or toggled.
  // "Active" is the whole attempt, not just the mic or the upload: the gap between stopping and the
// transcript landing is when a queued send is waiting, so the bar must stay through it (VS-450).
const active = !controller.dictation.settled;
  useDictationHotkey({
    enabled: !(typeof window !== 'undefined' && window.matchMedia('(hover: none)').matches) && (active || hotkeyAllowed),
    listening: controller.dictation.listening,
    start: startSession,
    stop: controller.stop,
  });

  const registerComposer = useCallback((getter: () => ComposerRegistration | null): (() => void) => {
    composerGetter.current = getter;
    setAttachmentsDropped(0);
    return () => {
      if (composerGetter.current !== getter) return;
      const last = getter();
      composerGetter.current = null;
      if (last && last.stagedFiles > 0) setAttachmentsDropped(last.stagedFiles);
    };
  }, []);

  const setHotkeyAllowed = useCallback((allowed: boolean): void => {
    setHotkeyAllowedState((cur) => (cur === allowed ? cur : allowed));
  }, []);

  const onTargetChat = target !== null && path === `/w/${encodeURIComponent(target.ws)}/chat`;
  // A send confirmation (or a "nothing was recognized" notice) has to be visible on the page the
  // human is on, so the bar lingers for it even after the attempt settles (VS-450).
  const visible = !onTargetChat && (active || controller.pendingNotice !== null || notice !== null);

  const session: DictationSessionValue = useMemo(
    () => ({
      ...controller,
      // Starting selects the target first, so `base` is the right thread's draft and the transcript
      // lands there — the raw controller start only opens the mic.
      start: startSession,
      target,
      active,
      barVisible: visible,
      attachmentsDropped,
      notice,
      registerComposer,
      setHotkeyAllowed,
      clearNotice,
    }),
    [controller, startSession, target, active, visible, attachmentsDropped, notice, registerComposer, setHotkeyAllowed, clearNotice],
  );

  return (
    <DictationSessionCtx.Provider value={session}>
      {children}
      {visible ? <DictationBar session={session} /> : null}
    </DictationSessionCtx.Provider>
  );
}