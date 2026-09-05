import { useCallback, useEffect, useRef, useState } from 'react';

/* Minimal typings — the Web Speech API is not in lib.dom for all TS versions. */
interface SpeechRecognitionAlternativeLike { transcript: string }
interface SpeechRecognitionResultLike { isFinal: boolean; 0: SpeechRecognitionAlternativeLike; length: number }
interface SpeechRecognitionEventLike { resultIndex: number; results: { length: number; [i: number]: SpeechRecognitionResultLike } }
interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: SpeechRecognitionEventLike) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  onsoundstart: (() => void) | null;
  onspeechstart: (() => void) | null;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function speechCtor(): SpeechRecognitionCtor | null {
  const w = window as unknown as { SpeechRecognition?: SpeechRecognitionCtor; webkitSpeechRecognition?: SpeechRecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export type DictationMode = 'speech' | 'upload' | 'unavailable';

export interface Dictation {
  mode: DictationMode;
  listening: boolean;
  /** seconds since the mic opened, for the 0:06 timer. */
  elapsed: number;
  /** Live analyser for the voice meter while the mic is open; read it from a rAF loop, never from render. */
  analyser: { current: AnalyserNode | null };
  /**
   * True only when this hook owns the microphone stream the transcriber is hearing, i.e. upload
   * mode. In speech mode the Web Speech API owns the mic and exposes no stream, so there is
   * nothing honest to meter — the composer must not draw a waveform then.
   */
  metered: boolean;
  error: string | null;
  start: () => void;
  stop: () => void;
  toggle: () => void;
}

/**
 * Voice dictation. Web Speech API where available; otherwise MediaRecorder
 * audio posted to `POST /api/transcribe`, which 501s when the provider is
 * `none` — in that case the mic stays visible, dimmed with a slash, and
 * explains itself on tap (DESIGN-CONTRACT §4).
 */
/**
 * Which path to use. The daemon's transcriber (private, works in every browser, needs a provider on
 * the daemon host) wins when it is configured; the browser's Web Speech API is the fallback — it
 * ships audio to the browser vendor's service and fails on `network` where that is unreachable.
 */
function pickMode(serverConfigured: boolean): DictationMode {
  if (typeof window === 'undefined') return 'unavailable';
  const md = typeof navigator !== 'undefined' ? navigator.mediaDevices : undefined;
  const canUpload = Boolean(md) && typeof MediaRecorder !== 'undefined';
  if (serverConfigured && canUpload) return 'upload';
  if (speechCtor()) return 'speech';
  return canUpload && serverConfigured ? 'upload' : 'unavailable';
}

const ERRORS: Record<string, string> = {
  'not-allowed': 'Microphone permission was denied.',
  'service-not-allowed': 'The browser blocked its speech service.',
  network: 'The browser could not reach its speech service. Configure a transcription provider on the daemon (Settings → Conductor) for dictation that never leaves your machines.',
  'no-speech': 'No speech was detected.',
  'audio-capture': 'No microphone was found.',
  aborted: 'Dictation was cancelled.',
};

const UNAVAILABLE = 'Dictation is not available in this browser, and the daemon has no transcription provider configured.';
/** The recognizer heard sound and still returned no words — not the same thing as silence. */
const NO_TRANSCRIPT = 'The browser heard audio but its speech service returned no words. Try again, or configure a transcription provider on the daemon (Settings \u2192 Conductor) for dictation that never leaves your machines.';

export function useDictation(onText: (text: string, final: boolean) => void, opts: { transcribeUrl?: string; serverConfigured?: boolean } = {}): Dictation {
  const [listening, setListening] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<DictationMode>(() => pickMode(Boolean(opts.serverConfigured)));
  const serverConfigured = opts.serverConfigured;
  // Ask the daemon once whether it transcribes; the composer stays free of data-layer providers.
  useEffect(() => {
    if (serverConfigured !== undefined) { setMode(pickMode(serverConfigured)); return; }
    if (typeof fetch !== 'function') return;
    let cancelled = false;
    fetch('/api/health', { credentials: 'include' })
      .then((r) => (r.ok ? (r.json() as Promise<{ transcription?: { configured?: boolean } }>) : null))
      .then((h) => { if (!cancelled && h) setMode(pickMode(Boolean(h.transcription?.configured))); })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [serverConfigured]);
  const [metered, setMetered] = useState(false);
  const wantListening = useRef(false);
  const gotResult = useRef(false);
  const heardAudio = useRef(false);

  const rec = useRef<SpeechRecognitionLike | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const analyser = useRef<{ ctx: AudioContext; node: AnalyserNode } | null>(null);
  const analyserNode = useRef<AnalyserNode | null>(null);
  const owned = useRef<MediaStream | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const elapsedRef = useRef(0);
  useEffect(() => { elapsedRef.current = elapsed; }, [elapsed]);
  const cb = useRef(onText);
  cb.current = onText;

  const stopMeters = useCallback(() => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    if (analyser.current) {
      void analyser.current.ctx.close();
      analyser.current = null;
    }
    analyserNode.current = null;
    // Release the mic we opened: closing the AudioContext alone leaves the tracks live, which keeps
    // the browser's recording indicator on and holds the capture against the next attempt.
    if (owned.current) {
      for (const t of owned.current.getTracks()) t.stop();
      owned.current = null;
    }
    setMetered(false);
    setElapsed(0);
  }, []);

  const meter = useCallback((stream: MediaStream) => {
    owned.current = stream;
    try {
      const ctx = new AudioContext();
      const node = ctx.createAnalyser();
      node.fftSize = 1024;
      node.smoothingTimeConstant = 0.6;
      ctx.createMediaStreamSource(stream).connect(node);
      analyser.current = { ctx, node };
      analyserNode.current = node;
      setMetered(true);
    } catch {
      /* metering is decoration */
    }
  }, []);

  const stop = useCallback(() => {
    wantListening.current = false;
    setListening(false);
    rec.current?.stop();
    rec.current = null;
    if (recorder.current && recorder.current.state !== 'inactive') recorder.current.stop();
    stopMeters();
  }, [stopMeters]);

  const start = useCallback(() => {
    setError(null);
    if (mode === 'unavailable') {
      setError(UNAVAILABLE);
      return;
    }
    // Resolve the recognizer before anything says "listening": a missing constructor here used to
    // leave the composer sitting on an open timer with nothing transcribing.
    const Ctor = mode === 'speech' ? speechCtor() : null;
    if (mode === 'speech' && !Ctor) {
      setMode('unavailable');
      setError(UNAVAILABLE);
      return;
    }
    setListening(true);
    wantListening.current = true;
    gotResult.current = false;
    heardAudio.current = false;
    timer.current = setInterval(() => setElapsed((s) => s + 1), 1000);

    if (Ctor) {
      const r = new Ctor();
      r.continuous = true;
      r.interimResults = true;
      r.lang = navigator.language || 'en-US';
      r.onresult = (e) => {
        // Results from `resultIndex` on: an interim result is re-sent (replaced) until it turns final.
        let text = '';
        let final = true;
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const res = e.results[i];
          if (!res) continue;
          text += res[0].transcript;
          if (!res.isFinal) final = false;
        }
        gotResult.current = true;
        cb.current(text, final);
      };
      // The recognizer is the only thing that can tell us it heard anything — we never touch its
      // stream. Without this, silence and "heard you, transcribed nothing" look identical.
      r.onsoundstart = () => { heardAudio.current = true; };
      r.onspeechstart = () => { heardAudio.current = true; };
      r.onerror = (e) => {
        if (e.error === 'no-speech' || e.error === 'aborted') return; // onend follows; re-armed or ended there
        setError(ERRORS[e.error] ?? `Dictation error: ${e.error}`);
        wantListening.current = false;
        setListening(false);
        stopMeters();
      };
      r.onend = () => {
        // Browsers end continuous recognition on their own (silence, ~60 s cap). Keep going until
        // the human stops, unless nothing ever came back — then say so instead of spinning.
        if (wantListening.current && rec.current === r) {
          if (!gotResult.current && elapsedRef.current >= 8) {
            setError(heardAudio.current ? NO_TRANSCRIPT : ERRORS['no-speech']!);
            wantListening.current = false;
            setListening(false);
            stopMeters();
            return;
          }
          try { r.start(); return; } catch { /* fall through */ }
        }
        if (rec.current === r) { setListening(false); stopMeters(); }
      };
      rec.current = r;
      try {
        r.start();
      } catch {
        setListening(false);
        wantListening.current = false;
        stopMeters();
      }
      // No getUserMedia here. The Web Speech API opens its own capture, and a second concurrent one
      // starves it on mobile browsers, where the microphone is effectively exclusive: the meter
      // bounced off our stream while the recognizer heard nothing and ended in "no speech" (VS-25).
      // Its stream cannot be read, so speech mode has no meter at all rather than a fictional one.
      return;
    }

    // upload mode
    navigator.mediaDevices
      .getUserMedia({ audio: true })
      .then((stream) => {
        meter(stream);
        chunks.current = [];
        const mr = new MediaRecorder(stream);
        recorder.current = mr;
        mr.ondataavailable = (e) => {
          if (e.data.size) chunks.current.push(e.data);
        };
        mr.onstop = () => {
          for (const t of stream.getTracks()) t.stop();
          const blob = new Blob(chunks.current, { type: mr.mimeType || 'audio/webm' });
          if (!blob.size) return;
          const fd = new FormData();
          fd.append('audio', blob, 'dictation.webm');
          void fetch(opts.transcribeUrl ?? '/api/transcribe', { method: 'POST', credentials: 'include', body: fd })
            .then(async (res) => {
              if (res.status === 501) {
                setMode(speechCtor() ? 'speech' : 'unavailable');
                setError('No transcription provider is configured on the daemon. Set one in Settings → Conductor.');
                return;
              }
              if (!res.ok) throw new Error(String(res.status));
              const json = (await res.json()) as { text?: string };
              if (json.text) cb.current(json.text, true);
            })
            .catch(() => setError('Transcription failed on the daemon. Type instead, or retry.'));
        };
        mr.start();
      })
      .catch(() => {
        setError('Microphone permission was denied.');
        setListening(false);
        stopMeters();
      });
  }, [mode, meter, stopMeters, opts.transcribeUrl]);

  const toggle = useCallback(() => (listening ? stop() : start()), [listening, start, stop]);

  useEffect(() => () => stop(), [stop]);

  return { mode, listening, elapsed, analyser: analyserNode, metered, error, start, stop, toggle };
}
