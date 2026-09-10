/**
 * Dictation, through the composer. The regression these guard is VS-25: on mobile the microphone is
 * effectively exclusive, so the meter's own `getUserMedia` capture starved the Web Speech
 * recognizer — bars moving, nothing transcribed, then "No speech was detected".
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState, type ReactElement } from 'react';
import { Composer } from '../components/Composer';
import { useDictation } from '../lib/dictation';

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
    for (let i = 0; i < DICTATION_DIAGNOSTICS_CAP + overflow; i++) {
      act(() => rec.onresult!(said([`word ${i}`, true])));
    }
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
    await waitFor(() => expect(getUserMedia).toHaveBeenCalled());
    fireEvent.click(screen.getByText('Stop dictation'));
    await waitFor(() => expect(posts.length).toBe(1));
    const file = posts[0]!.get('audio') as File;
    expect(file.name).toBe('dictation.wav');
    await waitFor(() => expect(screen.getByLabelText('out')).toHaveValue('hello host'));
  });

  it('surfaces a message instead of silence when Voxtype returns no words', async () => {
    vi.stubGlobal('fetch', vi.fn((_url: string, init?: RequestInit) => {
      if (init?.method === 'POST') return Promise.resolve({ ok: true, status: 200, json: async () => ({ text: '' }) });
      return Promise.resolve({ ok: false, status: 404, json: async () => ({}) });
    }));
    getUserMedia.mockResolvedValue({ getTracks: () => [{ stop: vi.fn() }] });
    render(<VoxtypeHarness backend="voxtype" serverConfigured />);
    fireEvent.click(screen.getByText('Dictate'));
    await waitFor(() => expect(getUserMedia).toHaveBeenCalled());
    fireEvent.click(screen.getByText('Stop dictation'));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/Nothing was recognized/));
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
    await waitFor(() => expect(getUserMedia).toHaveBeenCalled());
    fireEvent.click(screen.getByText('Stop dictation'));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/Transcription failed on the daemon/));
  });
});
