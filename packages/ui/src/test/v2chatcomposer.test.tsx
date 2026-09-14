/**
 * VS-349: the V2 chat composer — the three identical controls, the project scope selector, dictation
 * appended to the existing text, and attachments staged through the picker.
 *
 * VS-416: dictation takes over the input box itself (listening state where the textarea was, no
 * second row), a dictated insert scrolls the textarea to its end and moves the caret after it, the
 * hint is platform/input-aware, and a send while dictating waits for an upload-mode transcript so
 * the last words are not lost.
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { dictationHint } from '../lib/dictationHint';

const dict = vi.hoisted(() => ({
  onText: null as ((text: string, final: boolean) => void) | null,
  mode: 'speech' as 'speech' | 'upload' | 'unavailable',
  elapsed: 0,
  metered: false,
  error: null as string | null,
  setListening: null as ((v: boolean) => void) | null,
  setTranscribing: null as ((v: boolean) => void) | null,
  setSettled: null as ((v: boolean) => void) | null,
}));

vi.mock('../lib/dictation', async () => {
  const { useState } = await import('react');
  return {
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
        // The hook clears `settled` on start and only restores it when the attempt ends — the final
        // recognizer result on the speech path, the transcription response on the daemon path.
        start: () => { setListening(true); setSettled(false); },
        stop: () => { setListening(false); if (dict.mode === 'upload') setTranscribing(true); },
        toggle: () => undefined,
        diagnostics: { enabled: false, count: 0, copy: () => undefined },
      };
    },
  };
});

const { ChatComposer } = await import('../v2/ChatComposer');

const PROJECTS = [
  { id: 'p1', workspaceId: 'ws1', slug: 'web', name: 'web' },
  { id: 'p2', workspaceId: 'ws1', slug: 'api', name: 'api' },
] as never[];

function Harness({ onSubmit, clearOnSubmit = false }: { onSubmit: (text: string, files: File[], opts: { projectId: string | null; replyToMessageId: string | null; idempotencyKey: string }) => void | Promise<void>; clearOnSubmit?: boolean }): React.ReactElement {
  const [text, setText] = useState('');
  const [projectId, setProjectId] = useState<string | null>(null);
  return (
    <ChatComposer
      projects={PROJECTS}
      projectId={projectId}
      onChangeProject={setProjectId}
      value={text}
      onChange={setText}
      onSubmit={(t, f, o) => { const r = onSubmit(t, f, o); if (clearOnSubmit) setText(''); return r; }}
      onOpenSearch={vi.fn()}
      onOpenPlan={vi.fn()}
    />
  );
}

beforeEach(() => {
  dict.onText = null;
  dict.mode = 'speech';
  dict.elapsed = 0;
  dict.metered = false;
  dict.error = null;
  dict.setListening = null;
  dict.setTranscribing = null;
  dict.setSettled = null;
});

function dictate(): void {
  fireEvent.click(screen.getByRole('button', { name: 'Dictate' }));
}

/** The recognizer's final result on the speech path: the text lands, and only then the attempt settles. */
function finishSpeech(text: string): void {
  act(() => {
    dict.onText?.(text, true);
    dict.setSettled?.(true);
  });
}

/** The daemon's transcription response on the upload path. */
function finishTranscribe(text: string): void {
  act(() => {
    dict.onText?.(text, true);
    dict.setTranscribing?.(false);
    dict.setSettled?.(true);
  });
}

describe('the V2 chat composer', () => {
  it('renders three identical attach, dictate and send controls', () => {
    render(<Harness onSubmit={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Attach a file' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Dictate' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send' })).toBeInTheDocument();
  });

  it('renders a Plan button beside Search and calls onOpenPlan (VS-398)', () => {
    const onOpenPlan = vi.fn();
    render(
      <ChatComposer
        projects={PROJECTS}
        projectId={null}
        onChangeProject={vi.fn()}
        value=""
        onChange={vi.fn()}
        onSubmit={vi.fn()}
        onOpenSearch={vi.fn()}
        onOpenPlan={onOpenPlan}
      />,
    );
    const search = screen.getByRole('button', { name: 'Search this conversation' });
    const plan = screen.getByRole('button', { name: 'Plan a body of work interactively' });
    expect(plan.textContent?.trim()).toBe('Plan');
    expect(plan.compareDocumentPosition(search) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
    fireEvent.click(plan);
    expect(onOpenPlan).toHaveBeenCalledTimes(1);
  });

  it('hides the chat-only toolbar when no handlers are given and the scope is off', () => {
    render(
      <ChatComposer
        projects={PROJECTS}
        projectId={null}
        onChangeProject={vi.fn()}
        value=""
        onChange={vi.fn()}
        onSubmit={vi.fn()}
        showScope={false}
      />,
    );
    expect(screen.queryByRole('button', { name: 'Search this conversation' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Plan a body of work interactively' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Auto' })).not.toBeInTheDocument();
    // The three shared controls and the dictation hint stay.
    expect(screen.getByRole('button', { name: 'Attach a file' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Dictate' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send' })).toBeInTheDocument();
    expect(screen.getByText(/to dictate/)).toBeInTheDocument();
  });

  it('uses the supplied placeholder and accessible name', () => {
    render(
      <ChatComposer
        projects={PROJECTS}
        projectId={null}
        onChangeProject={vi.fn()}
        value=""
        onChange={vi.fn()}
        onSubmit={vi.fn()}
        placeholder="Talk through the plan…"
        ariaLabel="Message the planner"
      />,
    );
    expect(screen.getByLabelText('Message the planner')).toHaveAttribute('placeholder', 'Talk through the plan…');
  });

  it('sends the typed text once, with an idempotency key', () => {
    const onSubmit = vi.fn();
    render(<Harness onSubmit={onSubmit} />);
    fireEvent.change(screen.getByLabelText('Message the weaver'), { target: { value: 'ship it' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith('ship it', [], expect.objectContaining({ idempotencyKey: expect.any(String) }));
  });

  it('sends the chosen project as projectId and Auto as none', () => {
    const onSubmit = vi.fn();
    render(<Harness onSubmit={onSubmit} />);
    fireEvent.change(screen.getByLabelText('Message the weaver'), { target: { value: 'x' } });
    fireEvent.click(screen.getByRole('button', { name: 'web' }));
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(onSubmit).toHaveBeenLastCalledWith('x', [], expect.objectContaining({ projectId: 'p1' }));
  });

  it('appends the recognized transcript after the existing text', async () => {
    render(<Harness onSubmit={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Message the weaver'), { target: { value: 'Hi' } });
    dictate();
    act(() => dict.onText?.('there', true));
    fireEvent.click(screen.getByRole('button', { name: 'Stop dictation' }));
    // VS-425 streams the insert in; the committed draft is whole at once, the textarea catches up.
    await waitFor(() => expect(screen.getByLabelText('Message the weaver')).toHaveValue('Hi there'));
  });

  it('stages a file through the picker and sends it with the message', () => {
    const onSubmit = vi.fn();
    render(<Harness onSubmit={onSubmit} />);
    const input = screen.getByTestId('v2-composer-file-input');
    const file = new File(['notes'], 'notes.txt', { type: 'text/plain' });
    fireEvent.change(input, { target: { files: [file] } });
    expect(screen.getByText('notes.txt')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Message the weaver'), { target: { value: 'see file' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(onSubmit).toHaveBeenCalledWith('see file', [file], expect.objectContaining({ idempotencyKey: expect.any(String) }));
  });

  it('shows the error and keeps the text when the send is rejected', async () => {
    const onSubmit = vi.fn().mockRejectedValue(new Error('The daemon refused the message.'));
    render(<Harness onSubmit={onSubmit} />);
    fireEvent.change(screen.getByLabelText('Message the weaver'), { target: { value: 'keep me' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('The daemon refused the message.');
    expect(screen.getByLabelText('Message the weaver')).toHaveValue('keep me');
  });

  it('refuses an unaccepted file type with the shared message', () => {
    render(<Harness onSubmit={vi.fn()} />);
    fireEvent.change(screen.getByTestId('v2-composer-file-input'), {
      target: { files: [new File(['x'], 'archive.zip', { type: 'application/zip' })] },
    });
    expect(screen.getByRole('alert')).toHaveTextContent(/Only images/);
  });

  it('shows no focus outline or ring on the text field, but keeps it on the controls (VS-370)', () => {
    render(<Harness onSubmit={vi.fn()} />);
    const box = screen.getByLabelText('Message the weaver') as HTMLTextAreaElement;
    act(() => box.focus());
    expect(box).toHaveFocus();
    // `outline-none` kills the browser outline; `focus-visible:[box-shadow:none]` opts out of the
    // global `:focus-visible` ring the app applies to everything else.
    expect(box.className).toMatch(/outline-none/);
    expect(box.className).toMatch(/focus-visible:\[box-shadow:none\]/);
    // The three controls keep the global focus-visible ring: they do not opt out of it.
    for (const name of ['Attach a file', 'Dictate', 'Send']) {
      expect(screen.getByRole('button', { name }).className).not.toMatch(/box-shadow:none/);
    }
  });
});

describe('the V2 composer listening state (VS-416)', () => {
  it('replaces the textarea inside the composer box, with the elapsed time, and adds no second box', () => {
    dict.elapsed = 3;
    render(<Harness onSubmit={vi.fn()} />);
    dictate();

    const box = screen.getByTestId('v2-composer');
    const listening = screen.getByTestId('v2-composer-listening');
    expect(box).toContainElement(listening);
    expect(listening).toHaveTextContent('Listening…');
    expect(listening).toHaveTextContent('0:03');
    // The textarea is gone, and the only stop affordance is the mic turned square inside the box.
    expect(screen.queryByLabelText('Message the weaver')).not.toBeInTheDocument();
    const stop = screen.getByRole('button', { name: 'Stop dictation' });
    expect(box).toContainElement(stop);
    // Nothing was grown below the box: the listening node sits in the box's own textarea slot.
    expect(listening.parentElement).toBe(box);
    expect(screen.getAllByText('Listening…')).toHaveLength(1);
  });

  it('returns the textarea with the dictated text when dictation stops', async () => {
    render(<Harness onSubmit={vi.fn()} />);
    dictate();
    act(() => dict.onText?.('a dictated sentence', true));
    fireEvent.click(screen.getByRole('button', { name: 'Stop dictation' }));
    await waitFor(() => expect(screen.getByLabelText('Message the weaver')).toHaveValue('a dictated sentence'));
    expect(screen.queryByTestId('v2-composer-listening')).not.toBeInTheDocument();
  });

  it('reveals the dictated insert instead of dropping it in whole (VS-425)', () => {
    vi.useFakeTimers();
    try {
      render(<Harness onSubmit={vi.fn()} />);
      dictate();
      act(() => dict.onText?.('stream this sentence in', true));
      fireEvent.click(screen.getByRole('button', { name: 'Stop dictation' }));

      const box = screen.getByLabelText('Message the weaver') as HTMLTextAreaElement;
      act(() => { vi.advanceTimersByTime(80); });
      // Partway through: a prefix, not the whole transcript. That is the reveal.
      expect(box.value.length).toBeGreaterThan(0);
      expect(box.value.length).toBeLessThan('stream this sentence in'.length);

      act(() => { vi.advanceTimersByTime(600); });
      expect(box).toHaveValue('stream this sentence in');
    } finally {
      vi.useRealTimers();
    }
  });

  it('drops a dictated insert in whole under reduced motion (VS-425)', () => {
    const media = vi.spyOn(window, 'matchMedia').mockImplementation((query: string) => ({
      matches: query.includes('prefers-reduced-motion'),
      media: query,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    }) as unknown as MediaQueryList);
    render(<Harness onSubmit={vi.fn()} />);
    dictate();
    act(() => dict.onText?.('no animation please', true));
    fireEvent.click(screen.getByRole('button', { name: 'Stop dictation' }));
    expect(screen.getByLabelText('Message the weaver')).toHaveValue('no animation please');
    media.mockRestore();
  });

  it('empties the textarea after a dictated insert is sent (VS-425)', async () => {
    const onSubmit = vi.fn();
    // The screen clears its draft after a successful send; the composer must follow it, not stay
    // pinned to the text the reveal had been streaming in.
    render(<Harness onSubmit={onSubmit} clearOnSubmit />);
    dictate();
    act(() => dict.onText?.('send this by voice', true));
    fireEvent.click(screen.getByRole('button', { name: 'Stop dictation' }));
    // Sent while the reveal is still streaming: the draft clears, and the textarea must too.
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith('send this by voice', [], expect.objectContaining({ idempotencyKey: expect.any(String) })));
    await waitFor(() => expect(screen.getByLabelText('Message the weaver')).toHaveValue(''));
  });

  it('does not write the dictated text back when typing after a completed reveal (VS-425)', async () => {
    render(<Harness onSubmit={vi.fn()} />);
    dictate();
    act(() => dict.onText?.('the old dictated text', true));
    fireEvent.click(screen.getByRole('button', { name: 'Stop dictation' }));

    const box = screen.getByLabelText('Message the weaver') as HTMLTextAreaElement;
    await waitFor(() => expect(box).toHaveValue('the old dictated text'));

    fireEvent.change(box, { target: { value: 'typed instead' } });
    expect(box).toHaveValue('typed instead');
  });

  it('scrolls to the end and puts the caret after a dictated insert that overflows the box', async () => {
    // Upload mode has no live transcript: stop first, then the transcript lands (the moment the
    // scroll has to happen). jsdom has no layout, so the box's scroll metrics are faked.
    dict.mode = 'upload';
    render(<Harness onSubmit={vi.fn()} />);
    dictate();
    fireEvent.click(screen.getByRole('button', { name: 'Stop dictation' }));

    const box = screen.getByLabelText('Message the weaver') as HTMLTextAreaElement;
    let scrollTop = 0;
    Object.defineProperty(box, 'scrollTop', { configurable: true, get: () => scrollTop, set: (v: number) => { scrollTop = v; } });
    Object.defineProperty(box, 'scrollHeight', { configurable: true, get: () => 640 });

    const long = 'one two three four five six seven eight nine ten eleven twelve thirteen fourteen';
    act(() => dict.onText?.(long, true));

    // The reveal streams the text in; the box follows it to the end the whole way (VS-425).
    await waitFor(() => expect(box).toHaveValue(long));
    expect(box.selectionStart).toBe(long.length);
    expect(box.selectionEnd).toBe(long.length);
    expect(scrollTop).toBe(640);
  });
});

describe('the V2 composer dictation hint (VS-416)', () => {
  it('is Mac-shaped on macOS and Ctrl-shaped elsewhere, and names the hold', () => {
    expect(dictationHint({ isTouch: false, userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' })).toBe('hold ⌘⇧M to dictate');
    expect(dictationHint({ isTouch: false, userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' })).toBe('hold Ctrl+Shift+M to dictate');
    expect(dictationHint({ isTouch: false, userAgent: 'Mozilla/5.0 (X11; Linux x86_64)' })).toBe('hold Ctrl+Shift+M to dictate');
    expect(dictationHint({ isTouch: true, userAgent: 'Mozilla/5.0 (Macintosh)' })).toBe('tap the mic to dictate');
  });

  it('renders the Ctrl hint by default and the Mac hint under a Mac user agent', () => {
    const ua = vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 (Windows NT 10.0; Win64; x64)');
    const { unmount } = render(<Harness onSubmit={vi.fn()} />);
    expect(screen.getByText('hold Ctrl+Shift+M to dictate')).toBeInTheDocument();
    unmount();

    ua.mockReturnValue('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)');
    render(<Harness onSubmit={vi.fn()} />);
    expect(screen.getByText('hold ⌘⇧M to dictate')).toBeInTheDocument();
    ua.mockRestore();
  });

  it('keeps the touch hint when there is no keyboard', () => {
    const media = vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: true, media: '(hover: none)' } as MediaQueryList);
    render(<Harness onSubmit={vi.fn()} />);
    expect(screen.getByText('tap the mic to dictate')).toBeInTheDocument();
    media.mockRestore();
  });

  it('starts push-to-talk on meta and on ctrl, and stops on release', () => {
    render(<Harness onSubmit={vi.fn()} />);
    fireEvent.keyDown(window, { key: 'M', code: 'KeyM', metaKey: true, shiftKey: true });
    expect(screen.getByTestId('v2-composer-listening')).toBeInTheDocument();
    fireEvent.keyUp(window, { key: 'M', code: 'KeyM' });
    expect(screen.queryByTestId('v2-composer-listening')).not.toBeInTheDocument();

    fireEvent.keyDown(window, { key: 'M', code: 'KeyM', ctrlKey: true, shiftKey: true });
    expect(screen.getByTestId('v2-composer-listening')).toBeInTheDocument();
    fireEvent.keyUp(window, { key: 'M', code: 'KeyM' });
    expect(screen.queryByTestId('v2-composer-listening')).not.toBeInTheDocument();
  });

  it('does not claim the push-to-talk hotkey when hotkey is false', () => {
    render(
      <ChatComposer
        projects={PROJECTS}
        projectId={null}
        onChangeProject={vi.fn()}
        value=""
        onChange={vi.fn()}
        onSubmit={vi.fn()}
        hotkey={false}
      />,
    );
    fireEvent.keyDown(window, { key: 'M', code: 'KeyM', metaKey: true, shiftKey: true });
    expect(screen.queryByTestId('v2-composer-listening')).not.toBeInTheDocument();
    // The mic button still starts dictation: only the global shortcut is handed off.
    dictate();
    expect(screen.getByTestId('v2-composer-listening')).toBeInTheDocument();
  });
});

describe('the V2 composer send while dictating (VS-416)', () => {
  it('queues a speech-mode send and submits the final transcript that arrives after stop', () => {
    const onSubmit = vi.fn();
    render(<Harness onSubmit={onSubmit} />);
    dictate();
    // Empty box while dictating: send is available because it is what finishes the dictation.
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    // Stop happened, but the recognizer's final result has not landed: nothing may be submitted yet.
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.queryByTestId('v2-composer-listening')).not.toBeInTheDocument();

    finishSpeech('the full sentence that was dictated');

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith('the full sentence that was dictated', [], expect.objectContaining({ idempotencyKey: expect.any(String) }));
  });

  it('queues an upload-mode send and submits the transcript that lands, not the empty value', () => {
    dict.mode = 'upload';
    const onSubmit = vi.fn();
    render(<Harness onSubmit={onSubmit} />);
    dictate();
    // Empty value, but dictation is running, so send is available and stops the mic.
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.queryByTestId('v2-composer-listening')).not.toBeInTheDocument();

    finishTranscribe('the last words');

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith('the last words', [], expect.objectContaining({ idempotencyKey: expect.any(String) }));
  });

  it('submits nothing when the transcript comes back empty, and never an empty body', () => {
    dict.mode = 'upload';
    const onSubmit = vi.fn();
    render(<Harness onSubmit={onSubmit} />);
    dictate();
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    finishTranscribe('');

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole('status')).toHaveTextContent('Nothing was recognized, so nothing was sent.');
  });
});
