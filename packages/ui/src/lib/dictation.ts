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
  /** 14 bars of relative amplitude, 0..1. */
  levels: number[];
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
export function useDictation(onText: (text: string, final: boolean) => void, opts: { transcribeUrl?: string } = {}): Dictation {
  const [listening, setListening] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [levels, setLevels] = useState<number[]>(() => new Array(14).fill(0.15));
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<DictationMode>(() => {
    if (typeof window === 'undefined') return 'unavailable';
    if (speechCtor()) return 'speech';
    const md = typeof navigator !== 'undefined' ? navigator.mediaDevices : undefined;
    if (md && typeof MediaRecorder !== 'undefined') return 'upload';
    return 'unavailable';
  });

  const rec = useRef<SpeechRecognitionLike | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const analyser = useRef<{ ctx: AudioContext; node: AnalyserNode; raf: number } | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const cb = useRef(onText);
  cb.current = onText;

  const stopMeters = useCallback(() => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    if (analyser.current) {
      cancelAnimationFrame(analyser.current.raf);
      void analyser.current.ctx.close();
      analyser.current = null;
    }
    setLevels(new Array(14).fill(0.15));
    setElapsed(0);
  }, []);

  const meter = useCallback((stream: MediaStream) => {
    try {
      const ctx = new AudioContext();
      const node = ctx.createAnalyser();
      node.fftSize = 64;
      ctx.createMediaStreamSource(stream).connect(node);
      const data = new Uint8Array(node.frequencyBinCount);
      const tick = (): void => {
        node.getByteFrequencyData(data);
        const bars: number[] = [];
        for (let i = 0; i < 14; i++) bars.push(Math.max(0.12, (data[i * 2] ?? 0) / 255));
        setLevels(bars);
        if (analyser.current) analyser.current.raf = requestAnimationFrame(tick);
      };
      analyser.current = { ctx, node, raf: requestAnimationFrame(tick) };
    } catch {
      /* metering is decoration */
    }
  }, []);

  const stop = useCallback(() => {
    setListening(false);
    rec.current?.stop();
    rec.current = null;
    if (recorder.current && recorder.current.state !== 'inactive') recorder.current.stop();
    stopMeters();
  }, [stopMeters]);

  const start = useCallback(() => {
    setError(null);
    if (mode === 'unavailable') {
      setError('Dictation is not available in this browser, and the daemon has no transcription provider configured.');
      return;
    }
    setListening(true);
    timer.current = setInterval(() => setElapsed((s) => s + 1), 1000);

    if (mode === 'speech') {
      const Ctor = speechCtor();
      if (!Ctor) return;
      const r = new Ctor();
      r.continuous = true;
      r.interimResults = true;
      r.lang = navigator.language || 'en-US';
      r.onresult = (e) => {
        let text = '';
        let final = false;
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const res = e.results[i];
          if (!res) continue;
          text += res[0].transcript;
          if (res.isFinal) final = true;
        }
        cb.current(text, final);
      };
      r.onerror = (e) => {
        setError(e.error === 'not-allowed' ? 'Microphone permission was denied.' : `Dictation error: ${e.error}`);
        setListening(false);
        stopMeters();
      };
      r.onend = () => {
        setListening(false);
        stopMeters();
      };
      rec.current = r;
      try {
        r.start();
      } catch {
        setListening(false);
      }
      navigator.mediaDevices?.getUserMedia({ audio: true }).then(meter).catch(() => undefined);
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
                setMode('unavailable');
                setError('No transcription provider is configured on the daemon. Set one in Settings → Conductor.');
                return;
              }
              if (!res.ok) throw new Error(String(res.status));
              const json = (await res.json()) as { text?: string };
              if (json.text) cb.current(json.text, true);
            })
            .catch(() => setError('Transcription failed. Type instead, or retry.'));
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

  return { mode, listening, elapsed, levels, error, start, stop, toggle };
}
