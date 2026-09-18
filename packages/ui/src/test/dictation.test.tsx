/**
 * Dictation, through the composer. The regression these guard is VS-25: on mobile the microphone is
 * effectively exclusive, so the meter's own `getUserMedia` capture starved the Web Speech
 * recognizer — bars moving, nothing transcribed, then "No speech was detected".
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { useState, type ReactElement } from 'react';
import { Composer } from '../components/Composer';
import { useDictation } from '../lib/dictation';
import { DICTATION_HOLD_MS } from '../lib/dictationHotkey';
import { writeDictationAutoSend } from '../lib/dictationAutoSend';

/**
 * Wait for a condition that settles on the microtask queue, without ever reading the wall clock.
 *
 * Every await on the upload path — the `/api/health` probe, `getUserMedia`, `POST /api/transcribe`
 * and the body it returns — settles on a microtask. `waitFor` watches for that on a real timer, so
 * under a loaded suite its 50 ms polls can starve past the 1 s default and fail a case whose work
 * is already done (VS-438: the same one-off in `VS-282` and `VS-195` runs). Draining the microtask
 * queue inside `act` flushes those continuations and the render they cause, so the bound is
 * microtask turns, not seconds, and CPU load cannot make it late. The last call re-runs the
 * assertion so a condition that never becomes true still reports its own failure.
 *
 * This drains microtasks only. It cannot resolve a React `lazy()` chunk, whose Suspense retry is a
 * macrotask and spins this loop at 100% CPU (VS-446). For a lazy-chunk wait, use the shared
 * `eventually` in `./eventually`, which yields the event loop between attempts.
 */
async function settleMicrotasks(assertion: () => void, turns = 500): Promise<void> {
  for (let i = 0; i < turns; i++) {
    try {
      assertion();
      return;
    } catch {
      await act(async () => { await Promise.resolve(); });
    }
  }
  assertion();
}

interface ResultLike { isFinal: boolean; length: number; 0: { transcript: string } }

class FakeRecognition {
  static last: FakeRecognition | null = null;
  continuous = false;
  interimResults = false;
  lang = '';
  onresult: ((e: { resultIndex: number; results: ResultLike[] }) => void) | null = null;
  onerror: ((e: { error: string }) => void) | null = null;
  onend: (() => void) | null = null;
  onsoundstart: (() => void) | null = null;
  onspeechstart: (() => void) | null = null;
  start = vi.fn();
  stop = vi.fn();
  abort = vi.fn();
  constructor() {
    FakeRecognition.last = this;
  }
}

/**
 * One `result` event. The argument is the recognizer's whole results list for the session, because
 * that is what the real one hands back every time: it accumulates, and an interim result is
 * replaced in place at its own index until it turns final. `resultIndex` points at the first
 * result carried by this event, as Chrome sets it.
 */
function said(...parts: [string, boolean][]): { resultIndex: number; results: ResultLike[] } {
  const firstInterim = parts.findIndex(([, isFinal]) => !isFinal);
  return {
    resultIndex: firstInterim === -1 ? Math.max(parts.length - 1, 0) : firstInterim,
    results: parts.map(([transcript, isFinal]) => ({ isFinal, length: 1, 0: { transcript } })),
  };
}

const w = window as unknown as { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown };
const getUserMedia = vi.fn();
const writeText = vi.fn();

beforeEach(() => {
  FakeRecognition.last = null;
  getUserMedia.mockReset().mockRejectedValue(new Error('the test never expects a capture'));
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia } });
  // The hook probes /api/health for a daemon transcriber; keep it out of the network.
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
  writeText.mockReset().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  localStorage.removeItem('conductor.dictationDiagnostics');
});

afterEach(() => {
  delete w.SpeechRecognition;
  delete w.webkitSpeechRecognition;
  vi.unstubAllGlobals();
  vi.useRealTimers();
  localStorage.removeItem('conductor.dictationDiagnostics');
});

function dictate(): void {
  fireEvent.click(screen.getByLabelText('Dictate'));
}

describe('dictation — recognizer unavailable', () => {
  it('says so up front instead of pretending to listen', () => {
    render(<Composer onSubmit={() => undefined} placeholder="Message…" />);

    // No SpeechRecognition, no MediaRecorder: the mic is dimmed and slashed before anything is tapped.
    const mic = screen.getByLabelText('Dictation unavailable');
    fireEvent.click(mic);

    expect(screen.getByText(/Dictation is unavailable/)).toBeInTheDocument();
    expect(screen.queryByText('Listening…')).not.toBeInTheDocument();
    expect(getUserMedia).not.toHaveBeenCalled();
  });

  it('falls back to unavailable when the constructor is gone by the time the mic is tapped', () => {
    w.webkitSpeechRecognition = FakeRecognition;
    render(<Composer onSubmit={() => undefined} placeholder="Message…" />);
    delete w.webkitSpeechRecognition;

    dictate();

    expect(screen.getByRole('alert')).toHaveTextContent(/not available in this browser/);
    expect(screen.queryByText('Listening…')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Dictation unavailable')).toBeInTheDocument();
  });
});

describe('dictation — the desk shortcut (VS-432)', () => {
  beforeEach(() => {
    w.webkitSpeechRecognition = FakeRecognition;
  });

  it('toggles on a quick press, says to press again, and stops on the next press', () => {
    render(<Composer onSubmit={() => undefined} placeholder="Message…" />);
    fireEvent.keyDown(window, { key: ' ', code: 'Space', ctrlKey: true, shiftKey: true });
    expect(screen.getByText('Listening…')).toBeInTheDocument();

    fireEvent.keyUp(window, { key: ' ', code: 'Space' });
    expect(screen.getByText('Listening…')).toBeInTheDocument();
    expect(screen.getByText('press Ctrl+Shift+Space again to stop')).toBeInTheDocument();

    fireEvent.keyDown(window, { key: ' ', code: 'Space', ctrlKey: true, shiftKey: true });
    expect(screen.queryByText('Listening…')).not.toBeInTheDocument();
  });

  it('says to release during a hold, and stops when the key comes up past the threshold', () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(0);
    try {
      render(<Composer onSubmit={() => undefined} placeholder="Message…" />);
      fireEvent.keyDown(window, { key: ' ', code: 'Space', ctrlKey: true, shiftKey: true });
      expect(screen.getByText('release Ctrl+Shift+Space to stop')).toBeInTheDocument();

      clock.mockReturnValue(DICTATION_HOLD_MS);
      fireEvent.keyUp(window, { key: ' ', code: 'Space' });
      expect(screen.queryByText('Listening…')).not.toBeInTheDocument();
    } finally {
      clock.mockRestore();
    }
  });

  it('ends a hold when a modifier is released before Space', () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(0);
    try {
      render(<Composer onSubmit={() => undefined} placeholder="Message…" />);
      fireEvent.keyDown(window, { key: ' ', code: 'Space', ctrlKey: true, shiftKey: true });
      clock.mockReturnValue(DICTATION_HOLD_MS + 50);
      fireEvent.keyUp(window, { key: 'Shift' });
      expect(screen.queryByText('Listening…')).not.toBeInTheDocument();
    } finally {
      clock.mockRestore();
    }
  });

  it('swallows the chord so a space never reaches the input', () => {
    render(<Composer onSubmit={() => undefined} placeholder="Message…" />);
    expect(fireEvent.keyDown(window, { key: ' ', code: 'Space', ctrlKey: true, shiftKey: true })).toBe(false);
  });
});

describe('dictation — speech mode', () => {
  beforeEach(() => {
    w.webkitSpeechRecognition = FakeRecognition;
  });

  it('puts what the recognizer heard into the input, interim then final', () => {
    render(<Composer onSubmit={() => undefined} placeholder="Message…" />);
    const box = screen.getByLabelText('Message…') as HTMLTextAreaElement;

    dictate();
    const rec = FakeRecognition.last!;
    expect(rec.start).toHaveBeenCalled();
    expect(rec.continuous).toBe(true);
    expect(rec.interimResults).toBe(true);

    act(() => rec.onresult!(said(['add dark mode', false])));
    expect(box.value).toBe('add dark mode');

    // An interim result is replaced, not appended, until it turns final.
    act(() => rec.onresult!(said(['add dark mode to the board', true])));
    expect(box.value).toBe('add dark mode to the board');

    // Desktop's shape: the settled result stays put and the next phrase arrives beside it.
    act(() => rec.onresult!(said(['add dark mode to the board', true], [' and ship it', false])));
    expect(box.value).toBe('add dark mode to the board and ship it');

    act(() => rec.onresult!(said(['add dark mode to the board', true], [' and ship it', true])));
    expect(box.value).toBe('add dark mode to the board and ship it');
  });

  // VS-70: Android Chrome restates the whole utterance so far in every result it sends, and marks
  // the restatements final. Appending them gave the owner "we we we also we also need …".
  it('writes each word once when the recognizer restates the whole phrase every result', () => {
    render(<Composer onSubmit={() => undefined} placeholder="Message…" />);
    const box = screen.getByLabelText('Message…') as HTMLTextAreaElement;

    dictate();
    const rec = FakeRecognition.last!;
    const heard = [
      'we',
      'we also',
      'we also need',
      'we also need to',
      'we also need to document',
      'we also need to document the different services',
    ];
    for (let i = 0; i < heard.length; i++) {
      const upTo = heard.slice(0, i + 1).map((t) => [t, true] as [string, boolean]);
      act(() => rec.onresult!(said(...upTo)));
      expect(box.value).toBe(heard[i]);
    }

    // The live interim tail sits after the restatement and is itself replaced, not appended.
    const settled = heard.map((t) => [t, true] as [string, boolean]);
    act(() => rec.onresult!(said(...settled, ['fans like', false])));
    expect(box.value).toBe('we also need to document the different services fans like');
    act(() => rec.onresult!(said(...settled, ['fans like provides', true])));
    expect(box.value).toBe('we also need to document the different services fans like provides');
  });

  // VS-70: mobile ends a recognition session after every phrase, and the next one starts a fresh
  // results list — the text heard so far has to move forward with it, exactly once.
  it('carries the committed text across a restart mid-sentence', () => {
    render(<Composer onSubmit={() => undefined} placeholder="Message…" />);
    const box = screen.getByLabelText('Message…') as HTMLTextAreaElement;

    dictate();
    const rec = FakeRecognition.last!;
    act(() => rec.onresult!(said(['we also need to document', true])));
    expect(box.value).toBe('we also need to document');

    act(() => rec.onend!());
    expect(rec.start).toHaveBeenCalledTimes(2);

    act(() => rec.onresult!(said(['the different', false])));
    expect(box.value).toBe('we also need to document the different');

    act(() => rec.onresult!(said(['the different services', true])));
    expect(box.value).toBe('we also need to document the different services');
  });

  it('keeps text typed before the mic opened, and does not repeat it', () => {
    render(<Composer onSubmit={() => undefined} placeholder="Message…" />);
    const box = screen.getByLabelText('Message…') as HTMLTextAreaElement;

    fireEvent.change(box, { target: { value: 'typed first' } });
    dictate();
    const rec = FakeRecognition.last!;
    act(() => rec.onresult!(said(['and', true])));
    act(() => rec.onresult!(said(['and', true], ['and then some', true])));

    expect(box.value).toBe('typed first and then some');
  });

  it('never opens a microphone of its own, and shows no meter it cannot fill', () => {
    const { container } = render(<Composer onSubmit={() => undefined} placeholder="Message…" />);

    dictate();

    // The whole of VS-25: a second concurrent capture is what silenced the recognizer on mobile.
    expect(getUserMedia).not.toHaveBeenCalled();
    expect(container.querySelector('canvas')).toBeNull();
    expect(screen.getByText('Listening…')).toBeInTheDocument();
  });

  it('reports no speech only when the recognizer never heard a sound', () => {
    vi.useFakeTimers();
    render(<Composer onSubmit={() => undefined} placeholder="Message…" />);

    dictate();
    const rec = FakeRecognition.last!;
    act(() => { vi.advanceTimersByTime(9000); });
    act(() => rec.onend!());

    expect(screen.getByRole('alert')).toHaveTextContent('No speech was detected.');
  });

  it('does not claim silence when it heard audio but got no words back', () => {
    vi.useFakeTimers();
    render(<Composer onSubmit={() => undefined} placeholder="Message…" />);

    dictate();
    const rec = FakeRecognition.last!;
    act(() => rec.onspeechstart!());
    act(() => { vi.advanceTimersByTime(9000); });
    act(() => rec.onend!());

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent(/heard audio but its speech service returned no words/);
    expect(alert).not.toHaveTextContent('No speech was detected.');
  });

  it('stops the mic when the message is sent with the Send button', () => {
    const onSubmit = vi.fn();
    render(<Composer onSubmit={onSubmit} placeholder="Message…" />);

    dictate();
    const rec = FakeRecognition.last!;
    act(() => rec.onresult!(said(['ship the release', true])));

    fireEvent.click(screen.getByLabelText('Send'));

    expect(onSubmit).toHaveBeenCalledWith('ship the release', undefined, expect.any(String));
    expect(rec.stop).toHaveBeenCalled();
    expect(screen.getByLabelText('Dictate')).toBeInTheDocument();
    expect(screen.queryByLabelText('Stop dictation')).not.toBeInTheDocument();
    expect(screen.queryByText('Listening…')).not.toBeInTheDocument();
  });

  it('stops the mic when the message is sent with the keyboard', () => {
    const onSubmit = vi.fn();
    render(<Composer onSubmit={onSubmit} placeholder="Message…" />);
    const box = screen.getByLabelText('Message…') as HTMLTextAreaElement;

    dictate();
    const rec = FakeRecognition.last!;
    act(() => rec.onresult!(said(['ship the release', true])));

    fireEvent.keyDown(box, { key: 'Enter' });

    expect(onSubmit).toHaveBeenCalledWith('ship the release', undefined, expect.any(String));
    expect(rec.stop).toHaveBeenCalled();
    expect(screen.getByLabelText('Dictate')).toBeInTheDocument();
    expect(screen.queryByText('Listening…')).not.toBeInTheDocument();
  });

  it('leaves a mic that was never opened alone when sending', () => {
    const onSubmit = vi.fn();
    render(<Composer onSubmit={onSubmit} placeholder="Message…" />);
    const box = screen.getByLabelText('Message…') as HTMLTextAreaElement;

    fireEvent.change(box, { target: { value: 'typed by hand' } });
    fireEvent.click(screen.getByLabelText('Send'));

    expect(onSubmit).toHaveBeenCalledWith('typed by hand', undefined, expect.any(String));
    expect(FakeRecognition.last).toBeNull();
    expect(screen.getByLabelText('Dictate')).toBeInTheDocument();
  });

  it('keeps listening across the browser ending recognition on its own', () => {
    vi.useFakeTimers();
    render(<Composer onSubmit={() => undefined} placeholder="Message…" />);

    dictate();
    const rec = FakeRecognition.last!;
    act(() => rec.onresult!(said(['one', true])));
    act(() => { vi.advanceTimersByTime(9000); });
    act(() => rec.onend!());

    expect(rec.start).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Stop dictation')).toBeInTheDocument();
  });
});

/**
 * Ground truth capture (VS-121): no worker can dictate on a real phone, so a second guess at a fix
 * from a reconstructed event sequence is the same mistake VS-70 already made once. This records the
 * raw recognizer events instead, off by default, exported only by a deliberate copy.
 */
describe('dictation diagnostics', () => {
  beforeEach(() => {
    w.webkitSpeechRecognition = FakeRecognition;
  });

  function copyButton(): HTMLElement | null {
    return screen.queryByText(/Copy dictation diagnostics/);
  }

  function capturedLog(): unknown[] {
    fireEvent.click(copyButton()!);
    expect(writeText).toHaveBeenCalledTimes(1);
    return JSON.parse(writeText.mock.calls[0]![0] as string) as unknown[];
  }

  it('records nothing while the toggle is off', () => {
    render(<Composer onSubmit={() => undefined} placeholder="Message…" />);

    dictate();
    const rec = FakeRecognition.last!;
    act(() => rec.onresult!(said(['is H', false])));
    act(() => rec.onresult!(said(['is H2', true])));
    fireEvent.click(screen.getByLabelText('Stop dictation'));

    expect(copyButton()).not.toBeInTheDocument();
    expect(writeText).not.toHaveBeenCalled();
  });

  it('captures the raw sequence, including a restart, exactly', async () => {
    const { writeDictationDiagnosticsEnabled } = await import('../lib/dictationDiagnostics');
    writeDictationDiagnosticsEnabled(true);
    render(<Composer onSubmit={() => undefined} placeholder="Message…" />);

    dictate();
    const first = FakeRecognition.last!;
    act(() => first.onresult!(said(['is H', false])));
    act(() => first.onresult!(said(['is H2', true])));
    act(() => first.onend!());
    const second = FakeRecognition.last!;
    expect(second).toBe(first); // onend restarts the same instance, not a new one
    act(() => second.onresult!(said(['main', true])));

    // Not stopped: the fake recognizer's `.stop()` is a bare mock and never fires `onend` on its
    // own, exactly like the browser between a real stop and its eventual end event — the log is
    // asserted as of what has actually happened, not a simulated teardown this harness cannot give.
    expect(capturedLog()).toEqual([
      { kind: 'start' },
      { kind: 'result', resultIndex: 0, entries: [{ isFinal: false, transcript: 'is H' }], sessionTextAfter: 'is H', handedToComposer: 'is H', final: false },
      { kind: 'result', resultIndex: 0, entries: [{ isFinal: true, transcript: 'is H2' }], sessionTextAfter: 'is H2', handedToComposer: 'is H2', final: true },
      { kind: 'end', restarted: true, committedAfter: 'is H2' },
      { kind: 'result', resultIndex: 0, entries: [{ isFinal: true, transcript: 'main' }], sessionTextAfter: 'main', handedToComposer: 'is H2 main', final: true },
    ]);
  });

  it('turning diagnostics on mid-session starts an empty log rather than backfilling', async () => {
    const { writeDictationDiagnosticsEnabled } = await import('../lib/dictationDiagnostics');
    render(<Composer onSubmit={() => undefined} placeholder="Message…" />);

    // A first session, entirely before diagnostics is turned on.
    dictate();
    act(() => FakeRecognition.last!.onresult!(said(['before', true])));
    fireEvent.click(screen.getByLabelText('Stop dictation'));
    expect(copyButton()).not.toBeInTheDocument();

    act(() => writeDictationDiagnosticsEnabled(true));
    dictate();
    act(() => FakeRecognition.last!.onresult!(said(['after', true])));

    const log = capturedLog();
    expect(log).toHaveLength(2); // start, one result — nothing carried over from the first session
    expect(log).not.toEqual(expect.arrayContaining([expect.objectContaining({ sessionTextAfter: 'before' })]));
  });

  it('caps the log, dropping the oldest entries first', async () => {
    const { writeDictationDiagnosticsEnabled, DICTATION_DIAGNOSTICS_CAP } = await import('../lib/dictationDiagnostics');
    writeDictationDiagnosticsEnabled(true);
    render(<Composer onSubmit={() => undefined} placeholder="Message…" />);

    dictate();
    const rec = FakeRecognition.last!;
    const overflow = 10;
    // One `act` for the whole burst: React batches the updates, so this costs a render or two
    // rather than one per event. The default 5 s test timeout is otherwise reachable under a
    // loaded suite (VS-438), and the cap's behaviour is identical either way.
    act(() => {
      for (let i = 0; i < DICTATION_DIAGNOSTICS_CAP + overflow; i++) {
        rec.onresult!(said([`word ${i}`, true]));
      }
    });
    fireEvent.click(screen.getByLabelText('Stop dictation'));

    const log = capturedLog();
    expect(log).toHaveLength(DICTATION_DIAGNOSTICS_CAP);
    // `1 + overflow` entries were pushed before the cap started dropping: the `start` entry plus
    // the first `overflow` results — so the oldest survivor is the result right after those.
    expect(log[0]).toMatchObject({ kind: 'result', sessionTextAfter: `word ${overflow}` });
  });

  it('shows the copy control once something is captured, and copies only what was captured', async () => {
    const { writeDictationDiagnosticsEnabled } = await import('../lib/dictationDiagnostics');
    writeDictationDiagnosticsEnabled(true);
    render(<Composer onSubmit={() => undefined} placeholder="Message…" />);

    expect(copyButton()).not.toBeInTheDocument();
    dictate();
    expect(copyButton()).toHaveTextContent('1 event'); // the start entry alone
    act(() => FakeRecognition.last!.onresult!(said(['word', true])));
    expect(copyButton()).toHaveTextContent('2 events');

    fireEvent.click(copyButton()!);
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Copied')).toBeInTheDocument();
  });
});

function VoxtypeHarness(props: { backend?: 'chrome' | 'voxtype'; serverConfigured?: boolean }): ReactElement {
  const [text, setText] = useState('');
  const d = useDictation((t) => setText(t), { backend: props.backend, serverConfigured: props.serverConfigured });
  return (
    <div>
      <button type="button" onClick={() => (d.listening ? d.stop() : d.start())}>
        {d.listening ? 'Stop dictation' : 'Dictate'}
      </button>
      <span data-testid="mode">{d.mode}</span>
      <span data-testid="transcribing">{String(d.transcribing)}</span>
      <span data-testid="settled">{String(d.settled)}</span>
      {d.error ? <span role="alert">{d.error}</span> : null}
      <textarea aria-label="out" value={text} readOnly />
    </div>
  );
}

describe('dictation — voxtype upload', () => {
  it('stays on Chrome speech when only a leftover command provider would have been configured', () => {
    w.webkitSpeechRecognition = FakeRecognition;
    render(<VoxtypeHarness serverConfigured />);
    expect(screen.getByTestId('mode')).toHaveTextContent('speech');
    fireEvent.click(screen.getByText('Dictate'));
    expect(FakeRecognition.last?.start).toHaveBeenCalled();
    expect(getUserMedia).not.toHaveBeenCalled();
  });

  it('posts a 16 kHz wav when Voxtype is selected and ready', async () => {
    const posts: FormData[] = [];
    vi.stubGlobal('fetch', vi.fn((_url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        posts.push(init.body as FormData);
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ text: 'hello host' }) });
      }
      return Promise.resolve({ ok: false, status: 404, json: async () => ({}) });
    }));
    getUserMedia.mockResolvedValue({ getTracks: () => [{ stop: vi.fn() }] });
    render(<VoxtypeHarness backend="voxtype" serverConfigured />);
    expect(screen.getByTestId('mode')).toHaveTextContent('upload');
    fireEvent.click(screen.getByText('Dictate'));
    await settleMicrotasks(() => expect(getUserMedia).toHaveBeenCalled());
    fireEvent.click(screen.getByText('Stop dictation'));
    await settleMicrotasks(() => expect(posts.length).toBe(1));
    const file = posts[0]!.get('audio') as File;
    expect(file.name).toBe('dictation.wav');
    await settleMicrotasks(() => expect(screen.getByLabelText('out')).toHaveValue('hello host'));
  });

  it('surfaces a message instead of silence when Voxtype returns no words', async () => {
    vi.stubGlobal('fetch', vi.fn((_url: string, init?: RequestInit) => {
      if (init?.method === 'POST') return Promise.resolve({ ok: true, status: 200, json: async () => ({ text: '' }) });
      return Promise.resolve({ ok: false, status: 404, json: async () => ({}) });
    }));
    getUserMedia.mockResolvedValue({ getTracks: () => [{ stop: vi.fn() }] });
    render(<VoxtypeHarness backend="voxtype" serverConfigured />);
    fireEvent.click(screen.getByText('Dictate'));
    await settleMicrotasks(() => expect(getUserMedia).toHaveBeenCalled());
    fireEvent.click(screen.getByText('Stop dictation'));
    await settleMicrotasks(() => expect(screen.getByRole('alert')).toHaveTextContent(/Nothing was recognized/));
    expect(screen.getByLabelText('out')).toHaveValue('');
  });

  it('surfaces a failed host transcribe', async () => {
    vi.stubGlobal('fetch', vi.fn((_url: string, init?: RequestInit) => {
      if (init?.method === 'POST') return Promise.resolve({ ok: false, status: 500, json: async () => ({}) });
      return Promise.resolve({ ok: false, status: 404, json: async () => ({}) });
    }));
    getUserMedia.mockResolvedValue({ getTracks: () => [{ stop: vi.fn() }] });
    render(<VoxtypeHarness backend="voxtype" serverConfigured />);
    fireEvent.click(screen.getByText('Dictate'));
    await settleMicrotasks(() => expect(getUserMedia).toHaveBeenCalled());
    fireEvent.click(screen.getByText('Stop dictation'));
    await settleMicrotasks(() => expect(screen.getByRole('alert')).toHaveTextContent(/Transcription failed on the daemon/));
  });

  it('sets transcribing from stop() until the response settles, on every outcome (VS-195)', async () => {
    for (const outcome of [
      { name: 'a landed transcript', response: { ok: true, status: 200, json: async () => ({ text: 'hi' }) } },
      { name: 'an empty transcript', response: { ok: true, status: 200, json: async () => ({ text: '' }) } },
      { name: 'a 501 (provider unconfigured)', response: { ok: false, status: 501, json: async () => ({}) } },
      { name: 'a non-OK response', response: { ok: false, status: 500, json: async () => ({}) } },
    ] as const) {
      let settle: ((v: typeof outcome.response) => void) | null = null;
      vi.stubGlobal('fetch', vi.fn((_url: string, init?: RequestInit) => {
        if (init?.method === 'POST') return new Promise((resolve) => { settle = resolve; });
        return Promise.resolve({ ok: false, status: 404, json: async () => ({}) });
      }));
      getUserMedia.mockResolvedValue({ getTracks: () => [{ stop: vi.fn() }] });
      const { unmount } = render(<VoxtypeHarness backend="voxtype" serverConfigured />);
      fireEvent.click(screen.getByText('Dictate'));
      await settleMicrotasks(() => expect(getUserMedia).toHaveBeenCalled());
      fireEvent.click(screen.getByText('Stop dictation'));
      expect(screen.getByTestId('transcribing')).toHaveTextContent('true'); // outcome.name

      settle!(outcome.response);
      await settleMicrotasks(() => expect(screen.getByTestId('transcribing')).toHaveTextContent('false'));
      unmount();
      getUserMedia.mockReset();
    }
  });

  it('a network failure also clears transcribing (VS-195)', async () => {
    vi.stubGlobal('fetch', vi.fn((_url: string, init?: RequestInit) => {
      if (init?.method === 'POST') return Promise.reject(new Error('offline'));
      return Promise.resolve({ ok: false, status: 404, json: async () => ({}) });
    }));
    getUserMedia.mockResolvedValue({ getTracks: () => [{ stop: vi.fn() }] });
    render(<VoxtypeHarness backend="voxtype" serverConfigured />);
    fireEvent.click(screen.getByText('Dictate'));
    await settleMicrotasks(() => expect(getUserMedia).toHaveBeenCalled());
    fireEvent.click(screen.getByText('Stop dictation'));
    expect(screen.getByTestId('transcribing')).toHaveTextContent('true');
    await settleMicrotasks(() => expect(screen.getByTestId('transcribing')).toHaveTextContent('false'));
    expect(screen.getByRole('alert')).toHaveTextContent(/Transcription failed on the daemon/);
  });

  it('never sets transcribing on the speech path', async () => {
    w.webkitSpeechRecognition = FakeRecognition;
    render(<VoxtypeHarness serverConfigured />);
    expect(screen.getByTestId('mode')).toHaveTextContent('speech');
    fireEvent.click(screen.getByText('Dictate'));
    const rec = FakeRecognition.last!;
    act(() => rec.onresult!(said(['one', true])));
    fireEvent.click(screen.getByText('Stop dictation'));
    expect(screen.getByTestId('transcribing')).toHaveTextContent('false');
  });

  it('settles only after the recognizer ends on the speech path (VS-416)', () => {
    w.webkitSpeechRecognition = FakeRecognition;
    render(<VoxtypeHarness serverConfigured />);
    expect(screen.getByTestId('settled')).toHaveTextContent('true'); // nothing started yet
    fireEvent.click(screen.getByText('Dictate'));
    expect(screen.getByTestId('settled')).toHaveTextContent('false');
    const rec = FakeRecognition.last!;
    act(() => rec.onresult!(said(['one', true])));
    // A stop nulls `rec.current` before the recognizer ends; the final result still has to arrive.
    fireEvent.click(screen.getByText('Stop dictation'));
    expect(screen.getByTestId('settled')).toHaveTextContent('false');
    act(() => rec.onend!());
    expect(screen.getByTestId('settled')).toHaveTextContent('true');
  });

  it('settles only after the upload response lands (VS-416)', async () => {
    let settle: ((v: { ok: boolean; status: number; json: () => Promise<unknown> }) => void) | null = null;
    vi.stubGlobal('fetch', vi.fn((_url: string, init?: RequestInit) => {
      if (init?.method === 'POST') return new Promise((resolve) => { settle = resolve; });
      return Promise.resolve({ ok: false, status: 404, json: async () => ({}) });
    }));
    getUserMedia.mockResolvedValue({ getTracks: () => [{ stop: vi.fn() }] });
    render(<VoxtypeHarness backend="voxtype" serverConfigured />);
    fireEvent.click(screen.getByText('Dictate'));
    await settleMicrotasks(() => expect(getUserMedia).toHaveBeenCalled());
    expect(screen.getByTestId('settled')).toHaveTextContent('false');
    fireEvent.click(screen.getByText('Stop dictation'));
    expect(screen.getByTestId('settled')).toHaveTextContent('false');
    settle!({ ok: true, status: 200, json: async () => ({ text: 'hi' }) });
    await settleMicrotasks(() => expect(screen.getByTestId('settled')).toHaveTextContent('true'));
    expect(screen.getByLabelText('out')).toHaveValue('hi');
  });

  it('start() is a no-op while transcribing is in flight', async () => {
    let settle: ((v: { ok: boolean; status: number; json: () => Promise<unknown> }) => void) | null = null;
    vi.stubGlobal('fetch', vi.fn((_url: string, init?: RequestInit) => {
      if (init?.method === 'POST') return new Promise((resolve) => { settle = resolve; });
      return Promise.resolve({ ok: false, status: 404, json: async () => ({}) });
    }));
    getUserMedia.mockResolvedValue({ getTracks: () => [{ stop: vi.fn() }] });
    render(<VoxtypeHarness backend="voxtype" serverConfigured />);
    fireEvent.click(screen.getByText('Dictate'));
    await settleMicrotasks(() => expect(getUserMedia).toHaveBeenCalled());
    fireEvent.click(screen.getByText('Stop dictation'));
    expect(screen.getByTestId('transcribing')).toHaveTextContent('true');

    getUserMedia.mockClear();
    fireEvent.click(screen.getByText('Dictate')); // still transcribing: this must not start a second recording
    expect(getUserMedia).not.toHaveBeenCalled();

    settle!({ ok: true, status: 200, json: async () => ({ text: 'done' }) });
    await settleMicrotasks(() => expect(screen.getByTestId('transcribing')).toHaveTextContent('false'));
  });
});

/**
 * VS-195: Voxtype gives no live feedback — nothing appears until the human stops, and the
 * transcript itself lands a couple of seconds after that. The composer has to say so, lock itself
 * while either phase is in flight, and never stay locked no matter how the attempt ends.
 */
describe('dictation — composer lock while non-streaming (VS-195)', () => {
  function stubHealthAndTranscribe(
    postHandler: () => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>,
  ): void {
    vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
      if (init?.method === 'POST') return postHandler();
      if (typeof url === 'string' && url.includes('/api/health')) {
        return Promise.resolve({ ok: true, json: async () => ({ transcription: { configured: true, backend: 'voxtype' } }) });
      }
      return Promise.resolve({ ok: false, status: 404, json: async () => ({}) });
    }));
  }

  beforeEach(() => {
    getUserMedia.mockResolvedValue({ getTracks: () => [{ stop: vi.fn() }] });
  });

  async function renderUpload(): Promise<void> {
    render(<Composer onSubmit={() => undefined} placeholder="Message…" allowAttachments />);
    // The backend is resolved from an async /api/health probe; wait for it to land on upload mode
    // before touching the mic, the way a real page load would.
    await settleMicrotasks(() => expect(screen.getByLabelText('Dictate')).toBeInTheDocument());
  }

  it('locks the composer the moment recording starts, and unlocks with the transcript on success', async () => {
    stubHealthAndTranscribe(() => Promise.resolve({ ok: true, status: 200, json: async () => ({ text: 'ship it to the release train' }) }));
    await renderUpload();

    fireEvent.click(screen.getByLabelText('Dictate'));
    await settleMicrotasks(() => expect(getUserMedia).toHaveBeenCalled());

    expect(screen.getByLabelText('Message…')).toBeDisabled();
    expect(screen.getByLabelText('Attach a file')).toBeDisabled();
    // Send is deliberately not locked: on the non-streaming backend it is how the dictation is
    // finished and sent (VS-282). The textarea and attach lock above are what VS-195 still owns.
    expect(screen.getByLabelText('Send')).not.toBeDisabled();
    // Both halves, in one line: capturing now, and processed once you stop.
    expect(screen.getByText(/transcribed once you stop/i)).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('Stop dictation'));
    // Distinct from listening: a different label, and the mic itself is now inert.
    expect(screen.getByText('Transcribing…')).toBeInTheDocument();
    expect(screen.queryByText(/transcribed once you stop/i)).not.toBeInTheDocument();
    expect(screen.getByLabelText('Message…')).toBeDisabled();
    expect(screen.getByLabelText('Transcribing')).toBeDisabled();

    await settleMicrotasks(() => expect(screen.getByLabelText('Message…')).toHaveValue('ship it to the release train'));
    expect(screen.getByLabelText('Message…')).not.toBeDisabled();
    expect(screen.getByLabelText('Attach a file')).not.toBeDisabled();
    expect(screen.queryByText('Transcribing…')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Dictate')).toBeInTheDocument();
  });

  it('unlocks with nothing inserted when the transcript is empty', async () => {
    // VS-196 (landed on main while this ticket was in the merge queue) surfaces an empty transcript
    // as a message rather than silence; this ticket's concern is only that the composer never stays
    // locked over it — covered here regardless of which message, if any, accompanies it.
    stubHealthAndTranscribe(() => Promise.resolve({ ok: true, status: 200, json: async () => ({ text: '' }) }));
    await renderUpload();

    fireEvent.click(screen.getByLabelText('Dictate'));
    await settleMicrotasks(() => expect(getUserMedia).toHaveBeenCalled());
    fireEvent.click(screen.getByLabelText('Stop dictation'));

    await settleMicrotasks(() => expect(screen.getByLabelText('Message…')).not.toBeDisabled());
    expect(screen.getByLabelText('Message…')).toHaveValue('');
    expect(screen.queryByText('Transcribing…')).not.toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(/Nothing was recognized/);
  });

  it('unlocks and shows the failure when transcription fails', async () => {
    stubHealthAndTranscribe(() => Promise.resolve({ ok: false, status: 500, json: async () => ({}) }));
    await renderUpload();

    fireEvent.click(screen.getByLabelText('Dictate'));
    await settleMicrotasks(() => expect(getUserMedia).toHaveBeenCalled());
    fireEvent.click(screen.getByLabelText('Stop dictation'));

    await settleMicrotasks(() => expect(screen.getByRole('alert')).toHaveTextContent(/Transcription failed on the daemon/));
    expect(screen.getByLabelText('Message…')).not.toBeDisabled();
    expect(screen.getByLabelText('Attach a file')).not.toBeDisabled();
    expect(screen.queryByText('Transcribing…')).not.toBeInTheDocument();
  });

  it('does nothing when the mic is clicked while transcribing', async () => {
    let settle: ((v: { ok: boolean; status: number; json: () => Promise<unknown> }) => void) | null = null;
    stubHealthAndTranscribe(() => new Promise((resolve) => { settle = resolve; }));
    await renderUpload();

    fireEvent.click(screen.getByLabelText('Dictate'));
    await settleMicrotasks(() => expect(getUserMedia).toHaveBeenCalled());
    fireEvent.click(screen.getByLabelText('Stop dictation'));
    expect(screen.getByLabelText('Transcribing')).toBeDisabled();

    fireEvent.click(screen.getByLabelText('Transcribing'));
    expect(getUserMedia).toHaveBeenCalledTimes(1); // no second recording started

    settle!({ ok: true, status: 200, json: async () => ({ text: 'done' }) });
    await settleMicrotasks(() => expect(screen.getByLabelText('Message…')).not.toBeDisabled());
  });

  it('never hides the listening caption behind a viewport breakpoint', async () => {
    stubHealthAndTranscribe(() => new Promise(() => { /* not reached in this test */ }));
    await renderUpload();

    fireEvent.click(screen.getByLabelText('Dictate'));
    await settleMicrotasks(() => expect(getUserMedia).toHaveBeenCalled());

    const caption = screen.getByText(/transcribed once you stop/i);
    expect(caption.className).not.toMatch(/\bhidden\b/);
    expect(caption.className).not.toMatch(/sm:inline/);
  });

  it('leaves streaming (speech-mode) dictation entirely unlocked', () => {
    w.webkitSpeechRecognition = FakeRecognition;
    render(<Composer onSubmit={() => undefined} placeholder="Message…" allowAttachments />);

    fireEvent.click(screen.getByLabelText('Dictate'));
    const rec = FakeRecognition.last!;
    act(() => rec.onresult!(said(['ship it', true])));

    expect(screen.getByLabelText('Message…')).not.toBeDisabled();
    expect(screen.getByLabelText('Attach a file')).not.toBeDisabled();
    expect(screen.getByLabelText('Send')).not.toBeDisabled();
    expect(screen.queryByText('Transcribing…')).not.toBeInTheDocument();
    expect(screen.queryByText(/transcribed once you stop/i)).not.toBeInTheDocument();
  });
});

/**
 * VS-282: on the non-streaming (Voxtype) backend, send means "finish the dictation and send it".
 * These pin the stale-text trap (the submit must carry the transcript, not the text the composer
 * held when the button was pressed), the empty/failed clears, and one message per press sequence.
 */
describe('dictation — send finishes the upload dictation (VS-282)', () => {
  type TranscribeResponse = { ok: boolean; status: number; json: () => Promise<unknown> };

  function stubHealthAndTranscribe(postHandler: () => Promise<TranscribeResponse>): void {
    vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
      if (init?.method === 'POST') return postHandler();
      if (typeof url === 'string' && url.includes('/api/health')) {
        return Promise.resolve({ ok: true, json: async () => ({ transcription: { configured: true, backend: 'voxtype' } }) });
      }
      return Promise.resolve({ ok: false, status: 404, json: async () => ({}) });
    }));
  }

  function deferredResponse(): { promise: Promise<TranscribeResponse>; settle: (v: TranscribeResponse) => void } {
    let settle!: (v: TranscribeResponse) => void;
    const promise = new Promise<TranscribeResponse>((resolve) => { settle = resolve; });
    return { promise, settle };
  }

  function ok(text: string): TranscribeResponse {
    return { ok: true, status: 200, json: async () => ({ text }) };
  }

  beforeEach(() => {
    getUserMedia.mockResolvedValue({ getTracks: () => [{ stop: vi.fn() }] });
  });

  async function renderUpload(onSubmit: (text: string, files?: File[], idempotencyKey?: string) => void | Promise<void>): Promise<void> {
    render(<Composer onSubmit={onSubmit} placeholder="Message…" allowAttachments />);
    // `Dictate` only exists once the async /api/health probe has landed on upload mode; in these
    // tests there is no SpeechRecognition, so its presence pins the backend.
    await settleMicrotasks(() => expect(screen.getByLabelText('Dictate')).toBeInTheDocument());
  }

  it('pressing send while recording stops it and submits the transcript once it lands', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    stubHealthAndTranscribe(() => Promise.resolve(ok('ship it to the release train')));
    await renderUpload(onSubmit);

    fireEvent.click(screen.getByLabelText('Dictate'));
    await settleMicrotasks(() => expect(getUserMedia).toHaveBeenCalled());
    // The textarea and attach lock stay; only send is exempt (VS-282).
    expect(screen.getByLabelText('Message…')).toBeDisabled();
    expect(screen.getByLabelText('Attach a file')).toBeDisabled();
    expect(screen.getByLabelText('Send')).not.toBeDisabled();

    fireEvent.click(screen.getByLabelText('Send'));

    await settleMicrotasks(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit).toHaveBeenCalledWith('ship it to the release train', undefined, expect.any(String));
    expect(screen.getByLabelText('Message…')).toHaveValue('');
  });

  it('pressing send while already transcribing submits once the transcript lands', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const d = deferredResponse();
    stubHealthAndTranscribe(() => d.promise);
    await renderUpload(onSubmit);

    fireEvent.click(screen.getByLabelText('Dictate'));
    await settleMicrotasks(() => expect(getUserMedia).toHaveBeenCalled());
    fireEvent.click(screen.getByLabelText('Stop dictation'));
    expect(screen.getByText('Transcribing…')).toBeInTheDocument();
    getUserMedia.mockClear();

    fireEvent.click(screen.getByLabelText('Send'));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText(/Waiting for the transcript/)).toBeInTheDocument();

    d.settle(ok('late words from the host here'));
    await settleMicrotasks(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit).toHaveBeenCalledWith('late words from the host here', undefined, expect.any(String));
    expect(getUserMedia).not.toHaveBeenCalled(); // no second recording was started
  });

  it('a chord toggle-off with the mic or send control focused uploads once and reports no failure (VS-441)', async () => {
    const posts: RequestInit[] = [];
    vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        posts.push(init);
        return Promise.resolve(ok('once'));
      }
      if (url.includes('/api/health')) return Promise.resolve({ ok: true, json: async () => ({ transcription: { configured: true, backend: 'voxtype' } }) });
      return Promise.resolve({ ok: false, status: 404, json: async () => ({}) });
    }));
    await renderUpload(() => undefined);

    for (const label of ['Dictate', 'Send']) {
      posts.length = 0;
      getUserMedia.mockClear();
      screen.getByLabelText(label).focus();
      // A focused button is activated by Space's keyup; the chord must swallow both edges.
      fireEvent.keyDown(window, { key: ' ', code: 'Space', ctrlKey: true, shiftKey: true });
      fireEvent.keyUp(window, { key: ' ', code: 'Space' });
      fireEvent.keyDown(window, { key: ' ', code: 'Space', ctrlKey: true, shiftKey: true });
      fireEvent.keyUp(window, { key: ' ', code: 'Space' });

      await settleMicrotasks(() => expect(posts.length).toBe(1));
      expect(getUserMedia).toHaveBeenCalledTimes(1);
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      // Let the attempt settle before the next focused control.
      await settleMicrotasks(() => expect(screen.queryByText('Transcribing…')).not.toBeInTheDocument());
    }
  });

  it('a chord press while a transcript is in flight starts no second session (VS-441)', async () => {
    const d = deferredResponse();
    stubHealthAndTranscribe(() => d.promise);
    await renderUpload(() => undefined);

    fireEvent.click(screen.getByLabelText('Dictate'));
    await settleMicrotasks(() => expect(getUserMedia).toHaveBeenCalled());
    fireEvent.click(screen.getByLabelText('Stop dictation'));
    expect(screen.getByText('Transcribing…')).toBeInTheDocument();
    getUserMedia.mockClear();

    fireEvent.keyDown(window, { key: ' ', code: 'Space', ctrlKey: true, shiftKey: true });
    fireEvent.keyUp(window, { key: ' ', code: 'Space' });
    // The hook refuses to open a mic while it is still waiting for a transcript.
    expect(getUserMedia).not.toHaveBeenCalled();
    expect(screen.getByText('Transcribing…')).toBeInTheDocument();

    d.settle(ok('late words'));
    await settleMicrotasks(() => expect(screen.queryByText('Transcribing…')).not.toBeInTheDocument());
  });

  it('submits the transcript, not the pre-press text, when the two differ', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const d = deferredResponse();
    stubHealthAndTranscribe(() => d.promise);
    await renderUpload(onSubmit);

    fireEvent.change(screen.getByLabelText('Message…'), { target: { value: 'typed first' } });
    fireEvent.click(screen.getByLabelText('Dictate'));
    await settleMicrotasks(() => expect(getUserMedia).toHaveBeenCalled());
    fireEvent.click(screen.getByLabelText('Send'));
    d.settle(ok('spoken words that then arrived here'));

    await settleMicrotasks(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    const submitted = onSubmit.mock.calls[0]![0] as string;
    expect(submitted).toContain('spoken words');
    expect(submitted).toBe('typed first spoken words that then arrived here');
  });

  it('a failed transcript clears the queued send without submitting and leaves the composer usable', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    stubHealthAndTranscribe(() => Promise.resolve({ ok: false, status: 500, json: async () => ({}) }));
    await renderUpload(onSubmit);

    fireEvent.click(screen.getByLabelText('Dictate'));
    await settleMicrotasks(() => expect(getUserMedia).toHaveBeenCalled());
    fireEvent.click(screen.getByLabelText('Send'));

    await settleMicrotasks(() => expect(screen.getByRole('alert')).toHaveTextContent(/Transcription failed on the daemon/));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Message…')).not.toBeDisabled();
    expect(screen.queryByText(/Waiting for the transcript/)).not.toBeInTheDocument();
  });

  it('an empty transcript clears the queued send without submitting', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    stubHealthAndTranscribe(() => Promise.resolve(ok('')));
    await renderUpload(onSubmit);

    fireEvent.click(screen.getByLabelText('Dictate'));
    await settleMicrotasks(() => expect(getUserMedia).toHaveBeenCalled());
    fireEvent.click(screen.getByLabelText('Send'));

    await settleMicrotasks(() => expect(screen.getByRole('alert')).toHaveTextContent(/Nothing was recognized/));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Message…')).not.toBeDisabled();
    expect(screen.queryByText(/Waiting for the transcript/)).not.toBeInTheDocument();
  });

  it('one press sequence submits one message, however often send or the mic is pressed', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const d = deferredResponse();
    stubHealthAndTranscribe(() => d.promise);
    await renderUpload(onSubmit);

    fireEvent.click(screen.getByLabelText('Dictate'));
    await settleMicrotasks(() => expect(getUserMedia).toHaveBeenCalled());
    fireEvent.click(screen.getByLabelText('Send'));
    // The queued control is disabled, so a second press is a no-op; the mic is already stopped by
    // the send and disabled while transcribing, so it cannot submit a second time either.
    expect(screen.getByLabelText('Send queued')).toBeDisabled();
    fireEvent.click(screen.getByLabelText('Send queued'));
    expect(screen.getByLabelText('Transcribing')).toBeDisabled();

    d.settle(ok('once and then again here now'));
    await settleMicrotasks(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit).toHaveBeenCalledWith('once and then again here now', undefined, expect.any(String));
  });

  it('streaming (speech-mode) send stays immediate and unqueued', async () => {
    w.webkitSpeechRecognition = FakeRecognition;
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<Composer onSubmit={onSubmit} placeholder="Message…" allowAttachments />);
    await settleMicrotasks(() => expect(screen.getByLabelText('Dictate')).toBeInTheDocument());

    fireEvent.click(screen.getByLabelText('Dictate'));
    const rec = FakeRecognition.last!;
    act(() => rec.onresult!(said(['live words', true])));

    fireEvent.click(screen.getByLabelText('Send'));
    await settleMicrotasks(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit).toHaveBeenCalledWith('live words', undefined, expect.any(String));
    expect(screen.queryByText(/Waiting for the transcript/)).not.toBeInTheDocument();
  });
});

/**
 * VS-489: the Stop control does not send — the mic button ends the session and leaves the
 * transcript, submitting nothing.
 * VS-494: the keybinding is the path the auto-send setting exists for. A hold release or a
 * toggle-off submits the settled transcript when "Send automatically when dictation ends" is on,
 * and leaves it when off. Escape is covered separately below.
 */
describe('dictation — how a session ends decides whether it sends (VS-489, VS-494)', () => {
  type TranscribeResponse = { ok: boolean; status: number; json: () => Promise<unknown> };

  beforeEach(() => localStorage.removeItem('conductor.dictationAutoSend'));
  afterEach(() => localStorage.removeItem('conductor.dictationAutoSend'));

  function stubHealthAndTranscribe(postHandler: () => Promise<TranscribeResponse>): void {
    vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
      if (init?.method === 'POST') return postHandler();
      if (typeof url === 'string' && url.includes('/api/health')) {
        return Promise.resolve({ ok: true, json: async () => ({ transcription: { configured: true, backend: 'voxtype' } }) });
      }
      return Promise.resolve({ ok: false, status: 404, json: async () => ({}) });
    }));
  }

  function deferredResponse(): { promise: Promise<TranscribeResponse>; settle: (v: TranscribeResponse) => void } {
    let settle!: (v: TranscribeResponse) => void;
    const promise = new Promise<TranscribeResponse>((resolve) => { settle = resolve; });
    return { promise, settle };
  }

  function ok(text: string): TranscribeResponse {
    return { ok: true, status: 200, json: async () => ({ text }) };
  }

  async function renderUpload(onSubmit: (text: string, files?: File[], idempotencyKey?: string) => void | Promise<void>): Promise<void> {
    render(<Composer onSubmit={onSubmit} placeholder="Message…" allowAttachments />);
    await settleMicrotasks(() => expect(screen.getByLabelText('Dictate')).toBeInTheDocument());
  }

  it('leaves the transcript and sends nothing when the mic button stops speech', () => {
    w.webkitSpeechRecognition = FakeRecognition;
    const onSubmit = vi.fn();
    render(<Composer onSubmit={onSubmit} placeholder="Message…" />);

    fireEvent.change(screen.getByLabelText('Message…'), { target: { value: 'typed first' } });
    dictate();
    act(() => FakeRecognition.last!.onresult!(said(['and spoken words that stay here', true])));
    fireEvent.click(screen.getByLabelText('Stop dictation'));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Message…')).toHaveValue('typed first and spoken words that stay here');
  });

  it('leaves the transcript and sends nothing when a hold is released', () => {
    w.webkitSpeechRecognition = FakeRecognition;
    const onSubmit = vi.fn();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(0);
    try {
      render(<Composer onSubmit={onSubmit} placeholder="Message…" />);
      fireEvent.keyDown(window, { key: ' ', code: 'Space', ctrlKey: true, shiftKey: true });
      act(() => FakeRecognition.last!.onresult!(said(['held words that stay here now', true])));
      clock.mockReturnValue(DICTATION_HOLD_MS);
      fireEvent.keyUp(window, { key: ' ', code: 'Space' });

      expect(onSubmit).not.toHaveBeenCalled();
      expect(screen.getByLabelText('Message…')).toHaveValue('held words that stay here now');
    } finally {
      clock.mockRestore();
    }
  });

  it('leaves the transcript and sends nothing when a toggle is pressed off', () => {
    w.webkitSpeechRecognition = FakeRecognition;
    const onSubmit = vi.fn();
    render(<Composer onSubmit={onSubmit} placeholder="Message…" />);

    fireEvent.keyDown(window, { key: ' ', code: 'Space', ctrlKey: true, shiftKey: true });
    fireEvent.keyUp(window, { key: ' ', code: 'Space' });
    act(() => FakeRecognition.last!.onresult!(said(['toggle words that stay here now', true])));
    fireEvent.keyDown(window, { key: ' ', code: 'Space', ctrlKey: true, shiftKey: true });

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Message…')).toHaveValue('toggle words that stay here now');
  });

  it('keeps an upload transcript in the box and queues nothing', async () => {
    getUserMedia.mockResolvedValue({ getTracks: () => [{ stop: vi.fn() }] });
    const onSubmit = vi.fn();
    const d = deferredResponse();
    stubHealthAndTranscribe(() => d.promise);
    await renderUpload(onSubmit);

    fireEvent.change(screen.getByLabelText('Message…'), { target: { value: 'typed first' } });
    fireEvent.click(screen.getByLabelText('Dictate'));
    await settleMicrotasks(() => expect(getUserMedia).toHaveBeenCalled());
    fireEvent.click(screen.getByLabelText('Stop dictation'));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.queryByLabelText('Send queued')).not.toBeInTheDocument();

    d.settle(ok('spoken words that stay here now'));
    await settleMicrotasks(() => expect(screen.getByLabelText('Message…')).toHaveValue('typed first spoken words that stay here now'));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('shows a failed transcription as its error, not as a too-short discard', async () => {
    getUserMedia.mockResolvedValue({ getTracks: () => [{ stop: vi.fn() }] });
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    stubHealthAndTranscribe(() => Promise.resolve({ ok: false, status: 500, json: async () => ({}) }));
    await renderUpload(onSubmit);

    fireEvent.click(screen.getByLabelText('Dictate'));
    await settleMicrotasks(() => expect(getUserMedia).toHaveBeenCalled());
    fireEvent.click(screen.getByLabelText('Stop dictation'));

    await settleMicrotasks(() => expect(screen.getByRole('alert')).toHaveTextContent(/Transcription failed on the daemon/));
    expect(screen.getByRole('alert')).not.toHaveTextContent(/too short/);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('submits on a hold release when the setting is on', () => {
    w.webkitSpeechRecognition = FakeRecognition;
    writeDictationAutoSend(true);
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const clock = vi.spyOn(Date, 'now').mockReturnValue(0);
    try {
      render(<Composer onSubmit={onSubmit} placeholder="Message…" />);
      fireEvent.keyDown(window, { key: ' ', code: 'Space', ctrlKey: true, shiftKey: true });
      act(() => FakeRecognition.last!.onresult!(said(['held words that will be sent here', true])));
      clock.mockReturnValue(DICTATION_HOLD_MS);
      fireEvent.keyUp(window, { key: ' ', code: 'Space' });

      expect(onSubmit).toHaveBeenCalledTimes(1);
      expect(onSubmit).toHaveBeenCalledWith('held words that will be sent here', undefined, expect.any(String));
    } finally {
      clock.mockRestore();
    }
  });

  it('submits when a toggle session is pressed off and the setting is on', () => {
    w.webkitSpeechRecognition = FakeRecognition;
    writeDictationAutoSend(true);
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<Composer onSubmit={onSubmit} placeholder="Message…" />);

    fireEvent.keyDown(window, { key: ' ', code: 'Space', ctrlKey: true, shiftKey: true });
    fireEvent.keyUp(window, { key: ' ', code: 'Space' });
    act(() => FakeRecognition.last!.onresult!(said(['toggle words that will be sent now', true])));
    fireEvent.keyDown(window, { key: ' ', code: 'Space', ctrlKey: true, shiftKey: true });

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith('toggle words that will be sent now', undefined, expect.any(String));
  });

  it('does not send on the mic button even with the setting on', () => {
    w.webkitSpeechRecognition = FakeRecognition;
    writeDictationAutoSend(true);
    const onSubmit = vi.fn();
    render(<Composer onSubmit={onSubmit} placeholder="Message…" />);

    fireEvent.change(screen.getByLabelText('Message…'), { target: { value: 'typed first' } });
    dictate();
    act(() => FakeRecognition.last!.onresult!(said(['and spoken words that stay here', true])));
    fireEvent.click(screen.getByLabelText('Stop dictation'));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Message…')).toHaveValue('typed first and spoken words that stay here');
  });

  it('submits an upload transcript on a keybinding ending when the setting is on', async () => {
    getUserMedia.mockResolvedValue({ getTracks: () => [{ stop: vi.fn() }] });
    writeDictationAutoSend(true);
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const d = deferredResponse();
    stubHealthAndTranscribe(() => d.promise);
    const clock = vi.spyOn(Date, 'now').mockReturnValue(0);
    try {
      await renderUpload(onSubmit);
      fireEvent.change(screen.getByLabelText('Message…'), { target: { value: 'typed first' } });
      fireEvent.keyDown(window, { key: ' ', code: 'Space', ctrlKey: true, shiftKey: true });
      await settleMicrotasks(() => expect(getUserMedia).toHaveBeenCalled());
      clock.mockReturnValue(DICTATION_HOLD_MS);
      fireEvent.keyUp(window, { key: ' ', code: 'Space' });

      // Nothing yet: the transcript has not landed, and the queued cue is showing.
      expect(onSubmit).not.toHaveBeenCalled();
      expect(screen.getByLabelText('Send queued')).toBeInTheDocument();

      d.settle(ok('spoken words that will be sent now'));
      await settleMicrotasks(() => expect(onSubmit).toHaveBeenCalledTimes(1));
      expect(onSubmit).toHaveBeenCalledWith('typed first spoken words that will be sent now', undefined, expect.any(String));
    } finally {
      clock.mockRestore();
    }
  });
});

/**
 * VS-439, VS-552: a session that ends below three words is discarded — the draft goes back exactly
 * as it was, taking the interim words with it, and a queued send (VS-282) submits nothing.
 */
describe('dictation — discarding a transcript below three words (VS-439, VS-552)', () => {
  type TranscribeResponse = { ok: boolean; status: number; json: () => Promise<unknown> };

  function stubHealthAndTranscribe(postHandler: () => Promise<TranscribeResponse>): void {
    vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
      if (init?.method === 'POST') return postHandler();
      if (typeof url === 'string' && url.includes('/api/health')) {
        return Promise.resolve({ ok: true, json: async () => ({ transcription: { configured: true, backend: 'voxtype' } }) });
      }
      return Promise.resolve({ ok: false, status: 404, json: async () => ({}) });
    }));
  }

  beforeEach(() => {
    getUserMedia.mockResolvedValue({ getTracks: () => [{ stop: vi.fn() }] });
  });

  async function renderUpload(onSubmit: (text: string, files?: File[], idempotencyKey?: string) => void | Promise<void>): Promise<void> {
    render(<Composer onSubmit={onSubmit} placeholder="Message…" allowAttachments />);
    await settleMicrotasks(() => expect(screen.getByLabelText('Dictate')).toBeInTheDocument());
  }

  it('discards a two-word speech outcome and puts the draft back, removing the interim words', () => {
    w.webkitSpeechRecognition = FakeRecognition;
    render(<Composer onSubmit={() => undefined} placeholder="Message…" />);
    const box = screen.getByLabelText('Message…') as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: 'typed first' } });

    dictate();
    const rec = FakeRecognition.last!;
    act(() => rec.onresult!(said(['one two', false])));
    expect(box.value).toBe('typed first one two');

    fireEvent.click(screen.getByLabelText('Stop dictation'));
    act(() => rec.onresult!(said(['one two', true])));
    act(() => rec.onend!());

    expect(box.value).toBe('typed first');
  });

  it('inserts a three-word speech outcome', () => {
    w.webkitSpeechRecognition = FakeRecognition;
    render(<Composer onSubmit={() => undefined} placeholder="Message…" />);
    const box = screen.getByLabelText('Message…') as HTMLTextAreaElement;

    dictate();
    const rec = FakeRecognition.last!;
    act(() => rec.onresult!(said(['yes do that', true])));

    expect(box.value).toBe('yes do that');
  });

  it('discards an upload outcome and clears the queued send instead of submitting it', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    stubHealthAndTranscribe(() => Promise.resolve({ ok: true, status: 200, json: async () => ({ text: 'one two' }) }));
    await renderUpload(onSubmit);
    const box = screen.getByLabelText('Message…') as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: 'typed first' } });

    fireEvent.click(screen.getByLabelText('Dictate'));
    await settleMicrotasks(() => expect(getUserMedia).toHaveBeenCalled());
    fireEvent.click(screen.getByLabelText('Send'));

    // There is no live transcript on the upload path, so the draft reads `typed first` throughout —
    // the notice (and the queued state clearing) is what says the response has been handled.
    await settleMicrotasks(() => expect(screen.getByRole('alert')).toHaveTextContent(/too short/));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.queryByLabelText('Send queued')).not.toBeInTheDocument();
    expect(box).toHaveValue('typed first');
  });
});

describe('dictation — cancel abandons the attempt (VS-489)', () => {
  it('aborts an in-flight upload, delivers no transcript and settles', async () => {
    getUserMedia.mockResolvedValue({ getTracks: () => [{ stop: vi.fn() }] });
    vi.stubGlobal('fetch', vi.fn((_url: string, init?: RequestInit) => new Promise((_resolve, reject) => {
      // The real fetch rejects with an AbortError when the signal fires; the hook treats that as a
      // cancellation, not a transcription failure.
      init?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    })));
    const onText = vi.fn();
    const { result } = renderHook(() => useDictation(onText, { backend: 'voxtype', serverConfigured: true }));

    act(() => result.current.start());
    await settleMicrotasks(() => expect(getUserMedia).toHaveBeenCalled());
    act(() => result.current.stop());
    await settleMicrotasks(() => expect(result.current.transcribing).toBe(true));

    act(() => result.current.cancel());

    expect(onText).not.toHaveBeenCalled();
    expect(result.current.transcribing).toBe(false);
    expect(result.current.settled).toBe(true);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('ends a speech session without delivering its result', () => {
    w.SpeechRecognition = FakeRecognition;
    const onText = vi.fn();
    const { result } = renderHook(() => useDictation(onText));

    act(() => result.current.start());
    expect(result.current.listening).toBe(true);
    act(() => result.current.cancel());

    expect(result.current.listening).toBe(false);
    expect(result.current.settled).toBe(true);
    expect(onText).not.toHaveBeenCalled();
  });
});
