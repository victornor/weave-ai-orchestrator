/**
 * VS-450: the shell-level dictation session and its floating bar.
 *
 * A dictation started in the weaver chat keeps running when the human navigates to another V2 page,
 * the transcript lands in the target thread's draft, and the bar on any page can stop it or send it
 * to the weaver. The composer keeps its own local session (tested in v2chatcomposer); this file
 * drives the shared session with a stubbed `useDictation`, the way the composer tests do.
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useEffect, useRef, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { draftKey, readDraft } from '../lib/drafts';
import { writeDictationAutoSend } from '../lib/dictationAutoSend';
import type { ComposerRegistration } from '../v2/DictationSession';

const state = vi.hoisted(() => ({ path: '/w/acme/chat' }));
const dict = vi.hoisted(() => ({
  onText: null as ((text: string, final: boolean) => void) | null,
  mode: 'speech' as 'speech' | 'upload' | 'unavailable',
  elapsed: 0,
  metered: false,
  error: null as string | null,
  stops: 0,
  setListening: null as ((v: boolean) => void) | null,
  setTranscribing: null as ((v: boolean) => void) | null,
  setSettled: null as ((v: boolean) => void) | null,
}));
const sends = vi.hoisted(() => [] as Array<{ ws: string; path: string; body: unknown }>);
/** Texts a mounted composer's registered submit received (the on-chat send path). */
const submissions = vi.hoisted(() => [] as string[]);

vi.mock('@tanstack/react-router', () => ({
  useRouterState: (opts?: { select?: (s: { location: { pathname: string } }) => unknown }) =>
    opts?.select ? opts.select({ location: { pathname: state.path } }) : state.path,
}));

vi.mock('../app/link', () => ({
  A: ({ to, params, children, ...rest }: { to: string; params?: Record<string, unknown>; children?: React.ReactNode }) => (
    <a href={params ? to.replace('$ws', String(params.ws)) : to} {...rest}>
      {children}
    </a>
  ),
  useGo: () => () => undefined,
}));

vi.mock('../lib/dictation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/dictation')>();
  const { useState } = await import('react');
  return {
    ...actual,
    useDictation: (onText: (text: string, final: boolean) => void) => {
      dict.onText = onText;
      const [listening, setListening] = useState(false);
      const [transcribing, setTranscribing] = useState(false);
      const [settled, setSettled] = useState(true);
      dict.setListening = setListening;
      dict.setTranscribing = setTranscribing;
      dict.setSettled = setSettled;
      return {
        mode: dict.mode,
        listening,
        transcribing,
        settled,
        elapsed: dict.elapsed,
        analyser: { current: null },
        metered: dict.metered,
        error: dict.error,
        start: () => { setListening(true); setSettled(false); },
        stop: () => { dict.stops += 1; setListening(false); if (dict.mode === 'upload') setTranscribing(true); },
        toggle: () => undefined,
        diagnostics: { enabled: false, count: 0, copy: () => undefined },
      };
    },
  };
});

const { DictationSessionProvider, useDictationSession } = await import('../v2/DictationSession');
const { api } = await import('../api/client');

/** Registers itself as the live composer, as `ChatComposer` does. */
function Target({ files = 0, threadId = 't1' }: { files?: number; threadId?: string }): null {
  const session = useDictationSession();
  const reg = useRef<ComposerRegistration | null>(null);
  reg.current = session
    ? {
        target: { ws: 'acme', threadId, projectId: null, replyToMessageId: null },
        hotkeyAllowed: true,
        disabled: false,
        stagedFiles: files,
        submit: (text: string) => { submissions.push(text); },
      }
    : null;
  const register = session?.registerComposer;
  useEffect(() => {
    if (!register) return;
    return register(() => reg.current);
  }, [register]);
  const setAllowed = session?.setHotkeyAllowed;
  useEffect(() => { setAllowed?.(true); }, [setAllowed]);
  return null;
}

function Starter(): React.ReactElement {
  const session = useDictationSession();
  return (
    <button type="button" onClick={() => session?.start()}>
      start-dictation
    </button>
  );
}

/** Stands in for the composer's send arrow: the same `requestSend` path. */
function Sender(): React.ReactElement {
  const session = useDictationSession();
  return (
    <button type="button" onClick={() => session?.requestSend()}>
      send-shared
    </button>
  );
}

/** A route switch that mounts and unmounts the composer, as navigating in and out of chat does. */
function Harness({ initialOnChat = true, files = 0 }: { initialOnChat?: boolean; files?: number }): React.ReactElement {
  const [onChat, setOnChat] = useState(initialOnChat);
  const go = (next: boolean): void => {
    state.path = next ? '/w/acme/chat' : '/w/acme/work';
    setOnChat(next);
  };
  return (
    <>
      <button type="button" onClick={() => go(!onChat)}>
        toggle-route
      </button>
      <DictationSessionProvider>
        {onChat ? <Target files={files} /> : null}
        <Starter />
        <Sender />
      </DictationSessionProvider>
    </>
  );
}

const bar = (): HTMLElement | null => screen.queryByTestId('v2-dictation-bar');
const start = (): void => { fireEvent.click(screen.getByText('start-dictation')); };
const toggleRoute = (): void => { fireEvent.click(screen.getByText('toggle-route')); };

/** The recognizer's final result on the speech path: the text lands, and only then the attempt settles. */
function landSpeech(text: string): void {
  act(() => {
    dict.onText?.(text, true);
    dict.setSettled?.(true);
  });
}

function stopFromBar(): void {
  fireEvent.click(screen.getByRole('button', { name: 'Stop dictation' }));
}

beforeEach(() => {
  state.path = '/w/acme/chat';
  dict.onText = null;
  dict.mode = 'speech';
  dict.elapsed = 0;
  dict.metered = false;
  dict.error = null;
  dict.stops = 0;
  dict.setListening = null;
  dict.setTranscribing = null;
  dict.setSettled = null;
  sends.length = 0;
  submissions.length = 0;
  sessionStorage.clear();
  localStorage.removeItem('conductor.dictationAutoSend');
  vi.spyOn(api, 'ws').mockImplementation((async (ws: string, path: string, init?: { body?: unknown }) => {
    sends.push({ ws, path, body: init?.body });
    return {};
  }) as unknown as typeof api.ws);
});

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.removeItem('conductor.dictationAutoSend');
});

describe('the V2 dictation session across navigation (VS-450)', () => {
  it('hides the bar on the target chat and shows it on another page while listening', () => {
    render(<Harness />);
    start();
    expect(bar()).not.toBeInTheDocument();
    toggleRoute();
    expect(bar()).toBeInTheDocument();
    expect(screen.getByTestId('v2-dictation-bar')).toHaveTextContent('Listening…');
  });

  it('writes the transcript into the target thread draft while the chat is unmounted', () => {
    render(<Harness />);
    start();
    toggleRoute();
    act(() => dict.onText?.('these words land in the draft while away', true));
    expect(readDraft(draftKey('acme', 'thread:t1')).text).toBe('these words land in the draft while away');
    expect(bar()).toBeInTheDocument();
  });

  it('shows the elapsed timer in the bar', () => {
    dict.elapsed = 7;
    render(<Harness />);
    start();
    toggleRoute();
    expect(screen.getByTestId('v2-dictation-timer')).toHaveTextContent('0:07');
  });

  it('keeps dictating after the chat unmounts, then stops from the bar', () => {
    render(<Harness />);
    start();
    toggleRoute();
    expect(dict.stops).toBe(0);
    stopFromBar();
    expect(dict.stops).toBe(1);
  });

  it('stops and starts again from the shared chord off-chat', () => {
    render(<Harness />);
    fireEvent.keyDown(window, { key: ' ', code: 'Space', ctrlKey: true, shiftKey: true });
    fireEvent.keyUp(window, { key: ' ', code: 'Space' });
    toggleRoute();
    expect(bar()).toBeInTheDocument();
    fireEvent.keyDown(window, { key: ' ', code: 'Space', ctrlKey: true, shiftKey: true });
    expect(dict.stops).toBe(1);
  });
});

describe('sending from the V2 dictation bar (VS-450)', () => {
  it('posts the settled draft to the target thread and clears it', async () => {
    render(<Harness />);
    start();
    toggleRoute();
    // Send while listening: it stops and queues, then posts the transcript that lands (VS-282).
    fireEvent.click(screen.getByRole('button', { name: 'Send to the weaver' }));
    expect(sends).toHaveLength(0);
    landSpeech('six words are in this sentence now');

    await waitFor(() => expect(sends).toHaveLength(1));
    expect(sends[0]).toMatchObject({ ws: 'acme', path: '/threads/t1/messages' });
    expect((sends[0]!.body as { body: string }).body).toBe('six words are in this sentence now');
    await waitFor(() => expect(readDraft(draftKey('acme', 'thread:t1')).text).toBe(''));
    expect(screen.getByTestId('v2-dictation-notice')).toHaveTextContent('Sent to the weaver');
  });

  it('appends the transcript to an existing draft exactly once when sent from the bar', async () => {
    sessionStorage.setItem(draftKey('acme', 'thread:t1'), JSON.stringify({ text: 'prior words' }));
    render(<Harness />);
    start();
    toggleRoute();
    // Send while listening: it stops and queues, then posts the transcript that lands.
    fireEvent.click(screen.getByRole('button', { name: 'Send to the weaver' }));
    landSpeech('six more words arrive here now');

    await waitFor(() => expect(sends).toHaveLength(1));
    expect((sends[0]!.body as { body: string }).body).toBe('prior words six more words arrive here now');
    expect(readDraft(draftKey('acme', 'thread:t1')).text).toBe('');
  });

  it('submits the transcript once through the composer path on the target chat', async () => {
    render(<Harness />);
    start();
    act(() => dict.onText?.('six words land in the draft now', true));
    // The chat's own send arrow: the same requestSend, and the registered composer submit.
    fireEvent.click(screen.getByRole('button', { name: 'send-shared' }));
    act(() => dict.setSettled?.(true));

    await waitFor(() => expect(submissions).toHaveLength(1));
    expect(submissions[0]).toBe('six words land in the draft now');
    expect(readDraft(draftKey('acme', 'thread:t1')).text).toBe('six words land in the draft now');
  });

  it('auto-sends the settled draft when the setting is on (VS-435)', async () => {
    writeDictationAutoSend(true);
    render(<Harness />);
    start();
    toggleRoute();
    act(() => dict.onText?.('auto send these words to the weaver', true));
    stopFromBar();
    act(() => dict.setSettled?.(true));
    await waitFor(() => expect(sends).toHaveLength(1));
    expect((sends[0]!.body as { body: string }).body).toBe('auto send these words to the weaver');
  });

  it('discards a five-word outcome and sends nothing (VS-439)', () => {
    render(<Harness />);
    start();
    toggleRoute();
    act(() => dict.onText?.('one two three four five', true));
    stopFromBar();
    act(() => dict.setSettled?.(true));
    expect(readDraft(draftKey('acme', 'thread:t1')).text).toBe('');
    expect(sends).toHaveLength(0);
  });

  it('never sends an empty transcript', async () => {
    dict.mode = 'upload';
    render(<Harness />);
    start();
    toggleRoute();
    fireEvent.click(screen.getByRole('button', { name: 'Send to the weaver' }));
    // The upload comes back with no words: nothing may be posted, and the bar says so.
    act(() => {
      dict.onText?.('', true);
      dict.setTranscribing?.(false);
      dict.setSettled?.(true);
    });
    await waitFor(() => expect(screen.getByTestId('v2-dictation-notice')).toHaveTextContent('Nothing was recognized'));
    expect(sends).toHaveLength(0);
  });

  it('warns before sending when staged attachments were dropped leaving the chat', async () => {
    render(<Harness files={3} />);
    start();
    act(() => dict.onText?.('six words are in this sentence now', true));
    toggleRoute();
    expect(bar()).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Send to the weaver' }));
    expect(sends).toHaveLength(0);
    expect(screen.getByTestId('v2-dictation-attach-warning')).toHaveTextContent(/dropped when you left the chat/);

    fireEvent.click(screen.getByRole('button', { name: 'Send to the weaver' }));
    act(() => dict.setSettled?.(true));
    await waitFor(() => expect(sends).toHaveLength(1));
  });

  it('shows the transcribing animation in the bar in upload mode', () => {
    dict.mode = 'upload';
    render(<Harness />);
    start();
    toggleRoute();
    stopFromBar();
    expect(screen.getByTestId('v2-dictation-bar')).toHaveTextContent('Transcribing…');
  });
});