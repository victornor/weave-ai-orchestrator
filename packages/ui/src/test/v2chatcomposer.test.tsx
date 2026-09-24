/**
 * VS-349: the V2 chat composer — the three identical controls, the project scope selector, dictation
 * appended to the existing text, and attachments staged through the picker.
 *
 * VS-416: dictation takes over the input box itself (listening state where the textarea was, no
 * second row), a dictated insert scrolls the textarea to its end and moves the caret after it, the
 * hint is platform/input-aware, and a send while dictating waits for an upload-mode transcript so
 * the last words are not lost.
 */
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { dictationHint } from '../lib/dictationHint';
import { DICTATION_HOLD_MS } from '../lib/dictationHotkey';
import { writeDictationAutoSend } from '../lib/dictationAutoSend';

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

vi.mock('../lib/dictation', async (importOriginal) => {
  const { useState } = await import('react');
  const actual = await importOriginal<typeof import('../lib/dictation')>();
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
        // The hook clears `settled` on start and only restores it when the attempt ends — the final
        // recognizer result on the speech path, the transcription response on the daemon path.
        start: () => { setListening(true); setSettled(false); },
        stop: () => { dict.stops += 1; setListening(false); if (dict.mode === 'upload') setTranscribing(true); },
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

function Harness({ onSubmit, clearOnSubmit = false, blocks = [], initialProject = null, initialBlock = null }: { onSubmit: (text: string, files: File[], opts: { projectId: string | null; blockId: string | null; replyToMessageId: string | null; idempotencyKey: string }) => void | Promise<void>; clearOnSubmit?: boolean; blocks?: ReadonlyArray<{ id: string; title: string }>; initialProject?: string | null; initialBlock?: string | null }): React.ReactElement {
  const [text, setText] = useState('');
  const [projectId, setProjectId] = useState<string | null>(initialProject);
  const [blockId, setBlockId] = useState<string | null>(initialBlock);
  return (
    <ChatComposer
      projects={PROJECTS}
      projectId={projectId}
      onChangeProject={(id) => { setProjectId(id); setBlockId(null); }}
      blocks={blocks}
      blockId={blockId}
      onChangeBlock={setBlockId}
      value={text}
      onChange={setText}
      onSubmit={(t, f, o) => { const r = onSubmit(t, f, o); if (clearOnSubmit) setText(''); return r; }}
      onOpenSearch={vi.fn()}
    />
  );
}

beforeEach(() => {
  dict.onText = null;
  dict.mode = 'speech';
  dict.elapsed = 0;
  dict.metered = false;
  dict.error = null;
  dict.stops = 0;
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

  it('no longer renders a Plan control — starting a plan is the chat tab strip (VS-556)', () => {
    render(
      <ChatComposer
        projects={PROJECTS}
        projectId={null}
        onChangeProject={vi.fn()}
        value=""
        onChange={vi.fn()}
        onSubmit={vi.fn()}
        onOpenSearch={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: 'Search this conversation' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Plan a body of work interactively' })).not.toBeInTheDocument();
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

  it('offers the tagged project\u2019s open blocks and sends the chosen one as blockId (VS-491)', () => {
    const onSubmit = vi.fn();
    render(<Harness onSubmit={onSubmit} blocks={[{ id: 'b1', title: 'UI polish' }, { id: 'b2', title: 'Docs' }]} />);
    // Nothing is offered until a project is chosen.
    expect(screen.queryByRole('group', { name: 'Roadmap block for this message' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'web' }));

    const strip = screen.getByRole('group', { name: 'Roadmap block for this message' });
    expect(within(strip).getByRole('button', { name: 'No block' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(within(strip).getByRole('button', { name: 'UI polish' }));
    expect(within(strip).getByRole('button', { name: 'UI polish' })).toHaveAttribute('aria-pressed', 'true');

    fireEvent.change(screen.getByLabelText('Message the weaver'), { target: { value: 'x' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(onSubmit).toHaveBeenLastCalledWith('x', [], expect.objectContaining({ projectId: 'p1', blockId: 'b1' }));
  });

  it('labels the unset block choice "No block", never "Any block" (VS-665)', () => {
    render(<Harness onSubmit={vi.fn()} blocks={[{ id: 'b1', title: 'UI polish' }]} />);
    fireEvent.click(screen.getByRole('button', { name: 'web' }));
    const strip = screen.getByRole('group', { name: 'Roadmap block for this message' });
    expect(within(strip).queryByRole('button', { name: 'Any block' })).not.toBeInTheDocument();
    expect(within(strip).getByRole('button', { name: 'No block' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('sends no block when No block is active (VS-491, VS-665)', () => {
    const onSubmit = vi.fn();
    render(<Harness onSubmit={onSubmit} blocks={[{ id: 'b1', title: 'UI polish' }]} />);
    fireEvent.click(screen.getByRole('button', { name: 'web' }));
    fireEvent.click(screen.getByRole('button', { name: 'UI polish' }));
    fireEvent.click(screen.getByRole('button', { name: 'No block' }));
    fireEvent.change(screen.getByLabelText('Message the weaver'), { target: { value: 'x' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(onSubmit).toHaveBeenLastCalledWith('x', [], expect.objectContaining({ projectId: 'p1', blockId: null }));
  });

  it('offers no block strip for a project with no open block (VS-491)', () => {
    render(<Harness onSubmit={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'web' }));
    expect(screen.queryByRole('group', { name: 'Roadmap block for this message' })).not.toBeInTheDocument();
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
      // Six words or more: a shorter insert is discarded and never animated (VS-439).
      act(() => dict.onText?.('stream this whole sentence into the box', true));
      fireEvent.click(screen.getByRole('button', { name: 'Stop dictation' }));

      const box = screen.getByLabelText('Message the weaver') as HTMLTextAreaElement;
      act(() => { vi.advanceTimersByTime(80); });
      // Partway through: a prefix, not the whole transcript. That is the reveal.
      expect(box.value.length).toBeGreaterThan(0);
      expect(box.value.length).toBeLessThan('stream this whole sentence into the box'.length);

      act(() => { vi.advanceTimersByTime(600); });
      expect(box).toHaveValue('stream this whole sentence into the box');
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
    // While transcribing, the input slot holds the indicator, not the textarea (VS-441), so the
    // scroll is asserted on the textarea that returns when the transcript lands.
    expect(screen.getByTestId('v2-composer-transcribing')).toBeInTheDocument();

    const long = 'one two three four five six seven eight nine ten eleven twelve thirteen fourteen';
    finishTranscribe(long);

    const box = screen.getByLabelText('Message the weaver') as HTMLTextAreaElement;
    let scrollTop = 0;
    Object.defineProperty(box, 'scrollTop', { configurable: true, get: () => scrollTop, set: (v: number) => { scrollTop = v; } });
    Object.defineProperty(box, 'scrollHeight', { configurable: true, get: () => 640 });

    // The reveal streams the text in; the box follows it to the end the whole way (VS-425).
    await waitFor(() => expect(box).toHaveValue(long));
    expect(box.selectionStart).toBe(long.length);
    expect(box.selectionEnd).toBe(long.length);
    expect(scrollTop).toBe(640);
  });

it('shows the transcribing indicator in the box while the transcript is in flight (VS-441)', async () => {
    dict.mode = 'upload';
    render(<Harness onSubmit={vi.fn()} />);
    dictate();
    fireEvent.click(screen.getByRole('button', { name: 'Stop dictation' }));

    // The mic is closed and the textarea is not shown yet: the indicator takes the input slot, so
    // the box never flashes empty between listening and the text landing.
    const indicator = screen.getByTestId('v2-composer-transcribing');
    expect(indicator).toHaveTextContent('Transcribing…');
    expect(screen.queryByLabelText('Message the weaver')).not.toBeInTheDocument();

    finishTranscribe('landed words arrive in the box now');
    expect(screen.queryByTestId('v2-composer-transcribing')).not.toBeInTheDocument();
    // The reveal streams the text in, so the value settles over a few frames (VS-425).
    await waitFor(() => expect(screen.getByLabelText('Message the weaver')).toHaveValue('landed words arrive in the box now'));
  });
});

describe('the V2 composer dictation hint (VS-416, VS-432)', () => {
  it('is Mac-shaped on macOS and Ctrl-shaped elsewhere, and names both modes', () => {
    expect(dictationHint({ isTouch: false, userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' })).toBe('⌘⇧Space to dictate · hold to talk');
    expect(dictationHint({ isTouch: false, userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' })).toBe('Ctrl+Shift+Space to dictate · hold to talk');
    expect(dictationHint({ isTouch: false, userAgent: 'Mozilla/5.0 (X11; Linux x86_64)' })).toBe('Ctrl+Shift+Space to dictate · hold to talk');
    expect(dictationHint({ isTouch: true, userAgent: 'Mozilla/5.0 (Macintosh)' })).toBe('tap the mic to dictate');
  });

  it('renders the Ctrl hint by default and the Mac hint under a Mac user agent', () => {
    const ua = vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 (Windows NT 10.0; Win64; x64)');
    const { unmount } = render(<Harness onSubmit={vi.fn()} />);
    expect(screen.getByText('Ctrl+Shift+Space to dictate · hold to talk')).toBeInTheDocument();
    unmount();

    ua.mockReturnValue('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)');
    render(<Harness onSubmit={vi.fn()} />);
    expect(screen.getByText('⌘⇧Space to dictate · hold to talk')).toBeInTheDocument();
    ua.mockRestore();
  });

  it('keeps the touch hint when there is no keyboard', () => {
    const media = vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: true, media: '(hover: none)' } as MediaQueryList);
    render(<Harness onSubmit={vi.fn()} />);
    expect(screen.getByText('tap the mic to dictate')).toBeInTheDocument();
    media.mockRestore();
  });

  it('toggles on a quick press: one starts dictation, the next stops it', () => {
    render(<Harness onSubmit={vi.fn()} />);
    fireEvent.keyDown(window, { key: ' ', code: 'Space', metaKey: true, shiftKey: true });
    expect(screen.getByTestId('v2-composer-listening')).toBeInTheDocument();
    // Released at once: a toggle keeps the mic open rather than stopping.
    fireEvent.keyUp(window, { key: ' ', code: 'Space' });
    expect(screen.getByTestId('v2-composer-listening')).toBeInTheDocument();

    fireEvent.keyDown(window, { key: ' ', code: 'Space', ctrlKey: true, shiftKey: true });
    expect(screen.queryByTestId('v2-composer-listening')).not.toBeInTheDocument();
  });

  it('stops on release when the chord is held past the threshold', () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(0);
    try {
      render(<Harness onSubmit={vi.fn()} />);
      fireEvent.keyDown(window, { key: ' ', code: 'Space', ctrlKey: true, shiftKey: true });
      expect(screen.getByTestId('v2-composer-listening')).toBeInTheDocument();
      clock.mockReturnValue(DICTATION_HOLD_MS);
      fireEvent.keyUp(window, { key: ' ', code: 'Space' });
      expect(screen.queryByTestId('v2-composer-listening')).not.toBeInTheDocument();
    } finally {
      clock.mockRestore();
    }
  });

  it('swallows the chord so a space never reaches the textarea', () => {
    render(<Harness onSubmit={vi.fn()} />);
    // `fireEvent` returns false when the event was defaultPrevented.
    expect(fireEvent.keyDown(window, { key: ' ', code: 'Space', ctrlKey: true, shiftKey: true })).toBe(false);
  });

  it('does not claim the shortcut when hotkey is false', () => {
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
    fireEvent.keyDown(window, { key: ' ', code: 'Space', metaKey: true, shiftKey: true });
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

    finishTranscribe('the last words that then arrived');

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith('the last words that then arrived', [], expect.objectContaining({ idempotencyKey: expect.any(String) }));
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

/**
 * VS-489: the Stop control does not send — the mic button ends the session and leaves the
 * transcript, submitting nothing.
 * VS-494: the keybinding is the path the auto-send setting exists for. A hold release or a
 * toggle-off submits the settled transcript when "Send automatically when dictation ends" is on,
 * and leaves it when off. Only an explicit send (button or send keybinding) submits regardless,
 * through the queued VS-282/VS-416 path.
 */
describe('the V2 composer: the keybinding sends when auto-send is on, the mic never does (VS-489, VS-494)', () => {
  beforeEach(() => localStorage.removeItem('conductor.dictationAutoSend'));
  afterEach(() => localStorage.removeItem('conductor.dictationAutoSend'));

  it('leaves the transcript and sends nothing when the mic button stops it', async () => {
    const onSubmit = vi.fn();
    render(<Harness onSubmit={onSubmit} />);

    dictate();
    act(() => dict.onText?.('mic words that stay in the box', true));
    fireEvent.click(screen.getByRole('button', { name: 'Stop dictation' }));
    finishSpeech('mic words that stay in the box');

    await waitFor(() => expect(screen.getByLabelText('Message the weaver')).toHaveValue('mic words that stay in the box'));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('leaves the transcript and sends nothing when a hold is released', async () => {
    const onSubmit = vi.fn();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(0);
    try {
      render(<Harness onSubmit={onSubmit} />);
      fireEvent.keyDown(window, { key: ' ', code: 'Space', ctrlKey: true, shiftKey: true });
      act(() => dict.onText?.('held words that stay in the box', true));
      clock.mockReturnValue(DICTATION_HOLD_MS);
      fireEvent.keyUp(window, { key: ' ', code: 'Space' });
      finishSpeech('held words that stay in the box');

      await waitFor(() => expect(screen.getByLabelText('Message the weaver')).toHaveValue('held words that stay in the box'));
      expect(onSubmit).not.toHaveBeenCalled();
    } finally {
      clock.mockRestore();
    }
  });

  it('leaves the transcript and sends nothing when a toggle is pressed off', async () => {
    const onSubmit = vi.fn();
    render(<Harness onSubmit={onSubmit} />);

    fireEvent.keyDown(window, { key: ' ', code: 'Space', ctrlKey: true, shiftKey: true });
    fireEvent.keyUp(window, { key: ' ', code: 'Space' });
    act(() => dict.onText?.('toggle words that stay in the box', true));
    fireEvent.keyDown(window, { key: ' ', code: 'Space', ctrlKey: true, shiftKey: true });
    finishSpeech('toggle words that stay in the box');

    await waitFor(() => expect(screen.getByLabelText('Message the weaver')).toHaveValue('toggle words that stay in the box'));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('keeps the upload transcript in the box and queues nothing', async () => {
    dict.mode = 'upload';
    const onSubmit = vi.fn();
    render(<Harness onSubmit={onSubmit} />);

    dictate();
    fireEvent.click(screen.getByRole('button', { name: 'Stop dictation' }));
    finishTranscribe('last words that stay in the box');

    await waitFor(() => expect(screen.getByLabelText('Message the weaver')).toHaveValue('last words that stay in the box'));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Send queued' })).not.toBeInTheDocument();
  });

  it('still submits the settled transcript on an explicit Send press (VS-282/VS-416)', () => {
    const onSubmit = vi.fn();
    render(<Harness onSubmit={onSubmit} />);

    dictate();
    act(() => dict.onText?.('explicitly sent words land here now', true));
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    finishSpeech('explicitly sent words land here now');

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith('explicitly sent words land here now', [], expect.objectContaining({ idempotencyKey: expect.any(String) }));
  });

  it('submits on a hold release when the setting is on', async () => {
    writeDictationAutoSend(true);
    const onSubmit = vi.fn();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(0);
    try {
      render(<Harness onSubmit={onSubmit} />);
      fireEvent.keyDown(window, { key: ' ', code: 'Space', ctrlKey: true, shiftKey: true });
      act(() => dict.onText?.('held words that will be sent now', true));
      clock.mockReturnValue(DICTATION_HOLD_MS);
      fireEvent.keyUp(window, { key: ' ', code: 'Space' });

      finishSpeech('held words that will be sent now');
      await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
      expect(onSubmit).toHaveBeenCalledWith('held words that will be sent now', [], expect.objectContaining({ idempotencyKey: expect.any(String) }));
    } finally {
      clock.mockRestore();
    }
  });

  it('submits when a toggle is pressed off and the setting is on', async () => {
    writeDictationAutoSend(true);
    const onSubmit = vi.fn();
    render(<Harness onSubmit={onSubmit} />);

    fireEvent.keyDown(window, { key: ' ', code: 'Space', ctrlKey: true, shiftKey: true });
    fireEvent.keyUp(window, { key: ' ', code: 'Space' });
    act(() => dict.onText?.('toggle words that will be sent now', true));
    fireEvent.keyDown(window, { key: ' ', code: 'Space', ctrlKey: true, shiftKey: true });
    finishSpeech('toggle words that will be sent now');

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit).toHaveBeenCalledWith('toggle words that will be sent now', [], expect.objectContaining({ idempotencyKey: expect.any(String) }));
  });

  it('does not send on the mic button even with the setting on', async () => {
    writeDictationAutoSend(true);
    const onSubmit = vi.fn();
    render(<Harness onSubmit={onSubmit} />);

    dictate();
    act(() => dict.onText?.('mic words that stay in the box', true));
    fireEvent.click(screen.getByRole('button', { name: 'Stop dictation' }));
    finishSpeech('mic words that stay in the box');

    await waitFor(() => expect(screen.getByLabelText('Message the weaver')).toHaveValue('mic words that stay in the box'));
    expect(onSubmit).not.toHaveBeenCalled();
  });
});

/**
 * VS-439, VS-552: a session that ends below three words is discarded — the draft goes back exactly
 * as it was, nothing is inserted, the reveal never starts, and a queued send (VS-282) submits
 * nothing.
 */
describe('the V2 composer discards a transcript below three words (VS-439, VS-552)', () => {
  it('restores the draft and inserts nothing when the speech outcome is two words', () => {
    const onSubmit = vi.fn();
    render(<Harness onSubmit={onSubmit} />);
    fireEvent.change(screen.getByLabelText('Message the weaver'), { target: { value: 'typed first' } });

    dictate();
    // Interim words are on screen while talking — the textarea is the listening node then — and the
    // two-word outcome takes them all back out when the session ends.
    act(() => dict.onText?.('one two', false));
    fireEvent.click(screen.getByRole('button', { name: 'Stop dictation' }));
    finishSpeech('one two');

    expect(screen.getByLabelText('Message the weaver')).toHaveValue('typed first');
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('inserts a three-word speech outcome', async () => {
    render(<Harness onSubmit={vi.fn()} />);
    dictate();
    fireEvent.click(screen.getByRole('button', { name: 'Stop dictation' }));
    finishSpeech('yes do that');
    await waitFor(() => expect(screen.getByLabelText('Message the weaver')).toHaveValue('yes do that'));
  });

  it('does not start the reveal for a discarded insert', () => {
    render(<Harness onSubmit={vi.fn()} />);
    dictate();
    fireEvent.click(screen.getByRole('button', { name: 'Stop dictation' }));
    // The two-word outcome restores the (empty) draft at once and is never animated in.
    act(() => dict.onText?.('one two', true));
    expect(screen.getByLabelText('Message the weaver')).toHaveValue('');
  });

  it('discards an upload result and clears the queued send instead of submitting it', () => {
    dict.mode = 'upload';
    const onSubmit = vi.fn();
    render(<Harness onSubmit={onSubmit} />);
    fireEvent.change(screen.getByLabelText('Message the weaver'), { target: { value: 'typed first' } });

    dictate();
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(screen.getByRole('button', { name: 'Send queued' })).toBeInTheDocument();

    finishTranscribe('one two');

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Send queued' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Message the weaver')).toHaveValue('typed first');
    expect(screen.getByRole('status')).toHaveTextContent(/too short/);
  });
});

/**
 * VS-441: the chord's toggle-off has to behave exactly like the mic button, whichever control has
 * focus. A focused button is activated by the Space keyup, so the chord must swallow its own keyup;
 * otherwise the toggle-off could click the focused mic/send control and stop a second time.
 */
describe('the V2 composer chord stop with a focused control (VS-441)', () => {
  function chordOnOff(): void {
    fireEvent.keyDown(window, { key: ' ', code: 'Space', ctrlKey: true, shiftKey: true });
    fireEvent.keyUp(window, { key: ' ', code: 'Space' });
    fireEvent.keyDown(window, { key: ' ', code: 'Space', ctrlKey: true, shiftKey: true });
    fireEvent.keyUp(window, { key: ' ', code: 'Space' });
  }

  it.each(['Dictate', 'Send'])('stops exactly once when %s has focus', (label) => {
    const { unmount } = render(<Harness onSubmit={vi.fn()} />);
    screen.getByRole('button', { name: label }).focus();
    chordOnOff();
    expect(dict.stops).toBe(1);
    unmount();
  });

  it('stops exactly once when the stop control has focus', () => {
    render(<Harness onSubmit={vi.fn()} />);
    fireEvent.keyDown(window, { key: ' ', code: 'Space', ctrlKey: true, shiftKey: true });
    fireEvent.keyUp(window, { key: ' ', code: 'Space' });
    screen.getByRole('button', { name: 'Stop dictation' }).focus();
    fireEvent.keyDown(window, { key: ' ', code: 'Space', ctrlKey: true, shiftKey: true });
    fireEvent.keyUp(window, { key: ' ', code: 'Space' });
    expect(dict.stops).toBe(1);
  });
});

/**
 * VS-657: the send carries whether the draft was dictated, so the daemon can deliver the message with
 * the `(voice dictated)` line. Typed sends are unmarked; the "mark all my messages" setting marks them
 * too.
 */
describe('the V2 composer voice-dictated provenance (VS-657)', () => {
  afterEach(() => localStorage.removeItem('conductor.markAllDictated'));

  it('leaves a typed send unmarked', () => {
    const onSubmit = vi.fn();
    render(<Harness onSubmit={onSubmit} />);
    fireEvent.change(screen.getByLabelText('Message the weaver'), { target: { value: 'typed words here' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(onSubmit).toHaveBeenCalledWith('typed words here', [], expect.objectContaining({ dictated: false }));
  });

  it('marks a dictated send', () => {
    const onSubmit = vi.fn();
    render(<Harness onSubmit={onSubmit} />);
    dictate();
    act(() => dict.onText?.('spoken words from me', true));
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    finishSpeech('spoken words from me');
    expect(onSubmit).toHaveBeenCalledWith('spoken words from me', [], expect.objectContaining({ dictated: true }));
  });

  it('marks a typed send when "mark all my messages as voice dictated" is on', () => {
    localStorage.setItem('conductor.markAllDictated', 'on');
    const onSubmit = vi.fn();
    render(<Harness onSubmit={onSubmit} />);
    fireEvent.change(screen.getByLabelText('Message the weaver'), { target: { value: 'typed but marked' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(onSubmit).toHaveBeenCalledWith('typed but marked', [], expect.objectContaining({ dictated: true }));
  });
});
