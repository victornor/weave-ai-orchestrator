import { useCallback, useEffect, useRef, useState } from 'react';
import {
  appendCapture,
  formatDictationCapture,
  readDictationDiagnosticsEnabled,
  useDictationDiagnosticsEnabled,
  type DictationCaptureEntry,
} from './dictationDiagnostics.js';
import { downsampleTo16k, encodePcm16MonoWav } from './wav.js';

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

/** Words, lowercased and stripped of punctuation, so two transcripts compare by content. */
function words(s: string): string[] {
  return s.toLowerCase().replace(/[^\p{L}\p{N}\s']/gu, ' ').split(/\s+/).filter(Boolean);
}

/**
 * Join one transcript segment onto what is already assembled.
 *
 * Android Chrome restates the whole utterance so far in every result it sends — "we", "we also",
 * "we also need" — and marks the restatements final, so a consumer that appends each one ends up
 * with "we we we also we also need" (VS-70). A segment that repeats everything accumulated so far
 * therefore *replaces* it; anything else is genuinely new and is appended with a single space.
 */
export function mergeTranscript(acc: string, next: string): string {
  const piece = next.trim();
  if (!piece) return acc;
  const before = words(acc);
  if (!before.length) return piece;
  const after = words(piece);
  if (after.length >= before.length && before.every((w, i) => after[i] === w)) return piece;
  return `${acc.trimEnd()} ${piece}`;
}

export type DictationMode = 'speech' | 'upload' | 'unavailable';

export interface Dictation {
  mode: DictationMode;
  listening: boolean;
  /**
   * Upload mode only: true from the moment recording stops until the daemon's transcription
   * response has been handled — success, empty text, or error. Always `false` on the speech path,
   * which has no such gap (VS-195).
   */
  transcribing: boolean;
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
  /**
   * Ground truth for a duplication bug no worker can reproduce (VS-121): while
   * `conductor.dictationDiagnostics` is on, every raw recognizer event and restart boundary from the
   * most recent session is captured here for a human to copy out. Off by default, and recording
   * nothing at all while off — not merely hidden.
   */
  diagnostics: {
    enabled: boolean;
    /** Entries captured so far this session; empty whenever diagnostics is off. */
    count: number;
    copy: () => void;
  };
}

/**
 * Voice dictation. Web Speech API where available; otherwise MediaRecorder
 * audio posted to `POST /api/transcribe`, which 501s when the provider is
 * `none` — in that case the mic stays visible, dimmed with a slash, and
 * explains itself on tap (DESIGN-CONTRACT §4).
 */
/**
 * Which path to use. Chrome / Web Speech is the default. Upload (daemon Voxtype) only when the
 * daemon backend is `voxtype` and the host is ready — a leftover `command` provider must not steal
 * the mic (VS-179).
 */
function pickMode(opts: { backend?: string; hostReady?: boolean }): DictationMode {
  if (typeof window === 'undefined') return 'unavailable';
  const md = typeof navigator !== 'undefined' ? navigator.mediaDevices : undefined;
  const canRecord = Boolean(md);
  if (opts.backend === 'voxtype' && opts.hostReady && canRecord) return 'upload';
  if (speechCtor()) return 'speech';
  return 'unavailable';
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
/** The daemon transcribed successfully but recognized no words (VS-196) \u2014 not a failure, so no error is thrown. */
const NO_TRANSCRIPT_UPLOAD = 'Nothing was recognized in that recording. Try again.';

/**
 * `onText` receives the **whole** transcript dictated since the mic opened, not the newest fragment:
 * every call replaces what the previous one said. Assembling it here is what keeps the growing
 * interim phrase from being appended to itself (VS-70); `final` says the recognizer considers every
 * segment in it settled.
 */
export function useDictation(onText: (text: string, final: boolean) => void, opts: {
  transcribeUrl?: string;
  serverConfigured?: boolean;
  backend?: 'chrome' | 'voxtype';
} = {}): Dictation {
  const [listening, setListening] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const transcribingRef = useRef(false);
  const setTranscribingState = useCallback((v: boolean) => {
    transcribingRef.current = v;
    setTranscribing(v);
  }, []);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<DictationMode>(() => pickMode({ backend: opts.backend, hostReady: Boolean(opts.serverConfigured) }));
  const serverConfigured = opts.serverConfigured;
  const backendOpt = opts.backend;
  // Ask the daemon once which backend to use; the composer stays free of data-layer providers.
  useEffect(() => {
    if (backendOpt !== undefined || serverConfigured !== undefined) {
      setMode(pickMode({ backend: backendOpt, hostReady: Boolean(serverConfigured) }));
      return;
    }
    if (typeof fetch !== 'function') return;
    let cancelled = false;
    fetch('/api/health', { credentials: 'include' })
      .then((r) => (r.ok ? (r.json() as Promise<{ transcription?: { configured?: boolean; backend?: string } }>) : null))
      .then((h) => {
        if (!cancelled && h) setMode(pickMode({ backend: h.transcription?.backend, hostReady: Boolean(h.transcription?.configured) }));
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [serverConfigured, backendOpt]);
  const [metered, setMetered] = useState(false);
  const wantListening = useRef(false);
  const gotResult = useRef(false);
  const heardAudio = useRef(false);
  /** Transcript of recognition sessions this run has already finished — mobile ends one per phrase. */
  const committed = useRef('');
  /** Transcript of the session running now, rebuilt from its whole results list on every event. */
  const sessionText = useRef('');
  // Diagnostics: decided once per `start()`, from whatever the toggle says at that moment, so a
  // session already running is never backfilled by a later flip and a session begun with it off
  // never records. `capture` only ever reads state already being computed elsewhere in this hook —
  // it does not change what any of it decides.
  const diagnosticsWanted = useDictationDiagnosticsEnabled();
  const diagnosticsOn = useRef(false);
  const capture = useRef<DictationCaptureEntry[]>([]);
  const [captureCount, setCaptureCount] = useState(0);
  const record = useCallback((entry: DictationCaptureEntry) => {
    if (!diagnosticsOn.current) return;
    appendCapture(capture.current, entry);
    setCaptureCount(capture.current.length);
  }, []);

  const rec = useRef<SpeechRecognitionLike | null>(null);
  const pcmChunks = useRef<Float32Array[]>([]);
  const pcmRate = useRef(16000);
  const processor = useRef<{ disconnect: () => void } | null>(null);
  const uploadLive = useRef(false);
  const transcribeUrlRef = useRef(opts.transcribeUrl);
  transcribeUrlRef.current = opts.transcribeUrl;
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

  const postWav = useCallback((blob: Blob) => {
    if (!blob.size) {
      setTranscribingState(false);
      return;
    }
    const fd = new FormData();
    fd.append('audio', blob, 'dictation.wav');
    // `transcribing` clears in the same statement as whatever else each branch sets — never behind
    // a trailing `.finally()`. A `.catch().finally()` tail sets them across two separate promise
    // continuations, which land in two separate React commits often enough to matter: the composer's
    // queued-send effect reads `error` and `transcribing` together, and a render where `error` is
    // already set but `transcribing` is still true briefly shows both the failure alert and the
    // "waiting for the transcript" banner at once (found via VS-294, ~20% of runs).
    void (async () => {
      try {
        const res = await fetch(transcribeUrlRef.current ?? '/api/transcribe', { method: 'POST', credentials: 'include', body: fd });
        if (res.status === 501) {
          setMode(speechCtor() ? 'speech' : 'unavailable');
          setError('No transcription provider is configured on the daemon. Set one in Settings → Conductor.');
          setTranscribingState(false);
          return;
        }
        if (!res.ok) throw new Error(String(res.status));
        const json = (await res.json()) as { text?: string; error?: { message?: string } };
        if (json.text?.trim()) {
          cb.current(json.text, true);
        } else {
          setError(NO_TRANSCRIPT_UPLOAD);
        }
        setTranscribingState(false);
      } catch {
        setError('Transcription failed on the daemon. Type instead, or retry.');
        setTranscribingState(false);
      }
    })();
  }, [setTranscribingState]);

  const stop = useCallback(() => {
    const uploading = uploadLive.current;
    uploadLive.current = false;
    wantListening.current = false;
    setListening(false);
    rec.current?.stop();
    rec.current = null;
    if (processor.current) {
      processor.current.disconnect();
      processor.current = null;
    }
    let wav: Blob | null = null;
    if (uploading) {
      const chunks = pcmChunks.current;
      pcmChunks.current = [];
      let total = 0;
      for (const c of chunks) total += c.length;
      const samples = new Float32Array(Math.max(total, 1));
      let o = 0;
      for (const c of chunks) { samples.set(c, o); o += c.length; }
      wav = encodePcm16MonoWav(downsampleTo16k(samples, pcmRate.current), 16000);
    }
    stopMeters();
    if (wav) {
      setTranscribingState(true);
      postWav(wav);
    }
  }, [stopMeters, postWav, setTranscribingState]);

  const start = useCallback(() => {
    if (transcribingRef.current) return; // nothing left to stop mid-flight; wait for it to land
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
    committed.current = '';
    sessionText.current = '';
    // Read fresh, not the value this hook was rendered with: Settings and the composer are never
    // mounted together, and this is the moment a decision to record has to be made for the whole
    // session about to start.
    diagnosticsOn.current = readDictationDiagnosticsEnabled();
    capture.current = [];
    setCaptureCount(0);
    record({ kind: 'start' });
    timer.current = setInterval(() => setElapsed((s) => s + 1), 1000);

    if (Ctor) {
      const r = new Ctor();
      r.continuous = true;
      r.interimResults = true;
      r.lang = navigator.language || 'en-US';
      r.onresult = (e) => {
        // The whole results list, every time. An interim result is replaced in place at its own
        // index until it turns final, so rebuilding from index 0 is the only reading that cannot
        // double-count it — emitting the tail from `resultIndex` forced the consumer to append,
        // which is what duplicated every word on Android (VS-70).
        let text = '';
        let final = true;
        const entries: Array<{ isFinal: boolean; transcript: string }> = [];
        for (let i = 0; i < e.results.length; i++) {
          const res = e.results[i];
          if (!res) continue;
          text = mergeTranscript(text, res[0].transcript);
          if (!res.isFinal) final = false;
          entries.push({ isFinal: res.isFinal, transcript: res[0].transcript });
        }
        sessionText.current = text;
        gotResult.current = true;
        const handed = mergeTranscript(committed.current, text);
        record({ kind: 'result', resultIndex: e.resultIndex, entries, sessionTextAfter: text, handedToComposer: handed, final });
        cb.current(handed, final);
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
            record({ kind: 'end', restarted: false, committedAfter: committed.current });
            setError(heardAudio.current ? NO_TRANSCRIPT : ERRORS['no-speech']!);
            wantListening.current = false;
            setListening(false);
            stopMeters();
            return;
          }
          // The next session starts a fresh results list, so what this one heard has to move into
          // the committed prefix — otherwise the restart either loses it or repeats it.
          committed.current = mergeTranscript(committed.current, sessionText.current);
          sessionText.current = '';
          record({ kind: 'end', restarted: true, committedAfter: committed.current });
          try { r.start(); return; } catch { /* fall through */ }
        }
        if (rec.current === r) {
          record({ kind: 'end', restarted: false, committedAfter: committed.current });
          setListening(false);
          stopMeters();
        }
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

    // upload mode — PCM 16 kHz mono WAV for `voxtype transcribe`
    uploadLive.current = true;
    pcmChunks.current = [];
    navigator.mediaDevices
      .getUserMedia({ audio: true })
      .then((stream) => {
        meter(stream);
        const ctx = analyser.current?.ctx;
        if (ctx) {
          pcmRate.current = ctx.sampleRate || 16000;
          if (typeof ctx.createScriptProcessor === 'function') {
            const proc = ctx.createScriptProcessor(4096, 1, 1);
            proc.onaudioprocess = (e) => {
              pcmChunks.current.push(new Float32Array(e.inputBuffer.getChannelData(0)));
            };
            const mute = ctx.createGain();
            mute.gain.value = 0;
            ctx.createMediaStreamSource(stream).connect(proc);
            proc.connect(mute);
            mute.connect(ctx.destination);
            processor.current = proc;
          }
        }
      })
      .catch(() => {
        uploadLive.current = false;
        setError('Microphone permission was denied.');
        setListening(false);
        stopMeters();
      });
  }, [mode, meter, stopMeters]);

  const toggle = useCallback(() => (listening ? stop() : start()), [listening, start, stop]);

  useEffect(() => () => stop(), [stop]);

  const copyDiagnostics = useCallback(() => {
    void navigator.clipboard?.writeText(formatDictationCapture(capture.current));
  }, []);

  return {
    mode,
    listening,
    transcribing,
    elapsed,
    analyser: analyserNode,
    metered,
    error,
    start,
    stop,
    toggle,
    diagnostics: { enabled: diagnosticsWanted, count: captureCount, copy: copyDiagnostics },
  };
}
