/**
 * Dictation, through the composer. The regression these guard is VS-25: on mobile the microphone is
 * effectively exclusive, so the meter's own `getUserMedia` capture starved the Web Speech
 * recognizer — bars moving, nothing transcribed, then "No speech was detected".
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { Composer } from '../components/Composer';

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

function said(...parts: [string, boolean][]): { resultIndex: number; results: ResultLike[] } {
  return { resultIndex: 0, results: parts.map(([transcript, isFinal]) => ({ isFinal, length: 1, 0: { transcript } })) };
}

const w = window as unknown as { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown };
const getUserMedia = vi.fn();

beforeEach(() => {
  FakeRecognition.last = null;
  getUserMedia.mockReset().mockRejectedValue(new Error('the test never expects a capture'));
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia } });
  // The hook probes /api/health for a daemon transcriber; keep it out of the network.
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
});

afterEach(() => {
  delete w.SpeechRecognition;
  delete w.webkitSpeechRecognition;
  vi.unstubAllGlobals();
  vi.useRealTimers();
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

    act(() => rec.onresult!(said(['and ship it', true])));
    expect(box.value).toBe('add dark mode to the board and ship it');
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

    expect(onSubmit).toHaveBeenCalledWith('ship the release');
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

    expect(onSubmit).toHaveBeenCalledWith('ship the release');
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

    expect(onSubmit).toHaveBeenCalledWith('typed by hand');
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
