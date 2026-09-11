/**
 * Probe and one-shot transcribe via the Voxtype CLI. Never talks to `voxtype daemon`.
 * Tests inject a binary path; production looks up `voxtype` on PATH.
 */
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OcError } from '@agent-conductor/shared';
import { getLogger } from '@agent-conductor/core';

const log = getLogger('http', { component: 'voxtype' });

export interface VoxtypeModel {
  id: string;
  engine: string;
  installed: boolean;
}

export interface VoxtypeStatus {
  installed: boolean;
  models: VoxtypeModel[];
  error?: string;
}

export interface VoxtypeProbe {
  status(): Promise<VoxtypeStatus>;
  transcribe(audio: Buffer, model: string | undefined): Promise<string>;
}

export interface VoxtypeProbeOptions {
  binary?: string;
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 60_000;

const ANSI_RE = /\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~]|\][^\x07\x1B]*(?:\x07|\x1B\\))/g;
// Grounded in captured output, not assumed shapes (VS-186, VS-219): the three progress lines
// survive even `voxtype -q`; log lines appear both bare (2026-09-10) and prefixed with an
// ISO-8601 timestamp plus ANSI (2026-09-11), which is why the level word is not line-initial.
const DIAGNOSTIC_LINE =
  /^(?:Loading audio file:|Audio format:|Processing\b.*\bsamples\b|(?:\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z)?\s*(?:INFO|WARN(?:ING)?|DEBUG|ERROR|TRACE)\b|Transcription completed\b)/i;

export function extractVoxtypeTranscript(raw: string): string {
  const cleaned = raw.replace(ANSI_RE, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const kept: string[] = [];
  for (const line of cleaned.split('\n')) {
    if (DIAGNOSTIC_LINE.test(line.trim())) continue;
    kept.push(line);
  }
  return kept.join('\n').trim();
}

export function parseVoxtypeModelsJson(raw: string): VoxtypeModel[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!parsed || typeof parsed !== 'object') return [];
  const engines = (parsed as { engines?: unknown }).engines;
  if (!engines || typeof engines !== 'object') return [];
  const out: VoxtypeModel[] = [];
  for (const [engine, block] of Object.entries(engines as Record<string, unknown>)) {
    const models = block && typeof block === 'object' ? (block as { models?: unknown }).models : undefined;
    if (!Array.isArray(models)) continue;
    for (const m of models) {
      if (!m || typeof m !== 'object') continue;
      const name = (m as { name?: unknown }).name;
      if (typeof name !== 'string' || !name) continue;
      out.push({ id: name, engine, installed: Boolean((m as { installed?: unknown }).installed) });
    }
  }
  return out;
}

export function resolveVoxtypeModel(requested: string | undefined, status: VoxtypeStatus): string | undefined {
  const installed = status.models.filter((m) => m.installed);
  if (requested && installed.some((m) => m.id === requested)) return requested;
  return installed[0]?.id;
}

export interface WavAnalysis {
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
  durationSec: number;
  peakAmplitude: number;
  rms: number;
}

/**
 * Measures the audio actually handed to Voxtype (VS-196): the temp WAV is deleted right after the
 * call, so this is the only evidence of its format and level that outlives the request. Only reads
 * 16-bit PCM (what `wav.ts` always produces); anything else returns `null` rather than guessing.
 */
export function analyzeWav(buffer: Buffer): WavAnalysis | null {
  if (buffer.length < 44 || buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE') {
    return null;
  }
  let offset = 12;
  let fmt: { channels: number; sampleRate: number; bitsPerSample: number } | null = null;
  let data: { start: number; length: number } | null = null;
  while (offset + 8 <= buffer.length) {
    const id = buffer.toString('ascii', offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    const body = offset + 8;
    if (id === 'fmt ' && body + 16 <= buffer.length) {
      fmt = {
        channels: buffer.readUInt16LE(body + 2),
        sampleRate: buffer.readUInt32LE(body + 4),
        bitsPerSample: buffer.readUInt16LE(body + 14),
      };
    } else if (id === 'data') {
      data = { start: body, length: Math.min(size, buffer.length - body) };
    }
    offset = body + size + (size % 2);
  }
  if (!fmt || !data || fmt.bitsPerSample !== 16 || fmt.channels < 1 || fmt.sampleRate <= 0) return null;

  const sampleCount = Math.floor(data.length / 2);
  let peak = 0;
  let sumSquares = 0;
  for (let i = 0; i < sampleCount; i++) {
    const s = buffer.readInt16LE(data.start + i * 2) / 0x8000;
    const abs = Math.abs(s);
    if (abs > peak) peak = abs;
    sumSquares += s * s;
  }
  const framesPerChannel = sampleCount / fmt.channels;
  return {
    sampleRate: fmt.sampleRate,
    channels: fmt.channels,
    bitsPerSample: fmt.bitsPerSample,
    durationSec: fmt.sampleRate > 0 ? framesPerChannel / fmt.sampleRate : 0,
    peakAmplitude: peak,
    rms: sampleCount > 0 ? Math.sqrt(sumSquares / sampleCount) : 0,
  };
}

export function createVoxtypeProbe(opts: VoxtypeProbeOptions = {}): VoxtypeProbe {
  const binary = opts.binary ?? 'voxtype';
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return {
    async status(): Promise<VoxtypeStatus> {
      try {
        const r = await runVoxtype(binary, ['info', 'models', '--json'], { timeoutMs });
        if (r.code !== 0) {
          return { installed: false, models: [], error: (r.stderr || `voxtype exited ${r.code}`).slice(0, 500) };
        }
        return { installed: true, models: parseVoxtypeModelsJson(r.stdout) };
      } catch (e) {
        const err = e instanceof Error ? e : new Error(String(e));
        const missing = 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT';
        return { installed: false, models: [], error: missing ? 'voxtype is not installed' : err.message.slice(0, 500) };
      }
    },

    async transcribe(audio: Buffer, model: string | undefined): Promise<string> {
      const dir = await mkdtemp(join(tmpdir(), 'ac-voxtype-'));
      const wav = join(dir, 'dictation.wav');
      try {
        await writeFile(wav, audio);
        const analysis = analyzeWav(audio);
        log.info({ analysis }, 'voxtype transcribe input audio');
        // -q: quiet mode. Verified on voxtype 1.0.1 that this suppresses the timestamped
        // INFO/WARN lines entirely, so logs never share stdout with the transcript (VS-219).
        const args = model ? ['-q', '--model', model, 'transcribe', wav] : ['-q', 'transcribe', wav];
        const r = await runVoxtype(binary, args, { timeoutMs });
        if (r.code !== 0) {
          log.warn({ code: r.code, err: r.stderr.slice(0, 500) }, 'voxtype transcribe failed');
          throw new OcError('internal', `voxtype transcribe exited with ${r.code}`, { stderr: r.stderr.slice(0, 500) });
        }
        const text = extractVoxtypeTranscript(r.stdout);
        if (!text) {
          log.warn({ analysis, stdout: r.stdout.slice(0, 2000) }, 'voxtype transcribe returned an empty transcript');
        }
        return text;
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
  };
}

function runVoxtype(
  binary: string,
  args: string[],
  opts: { timeoutMs: number },
): Promise<{ stdout: string; stderr: string; code: number | null }> {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish(() => reject(new OcError('internal', `voxtype timed out after ${opts.timeoutMs}ms`)));
    }, opts.timeoutMs);
    child.stdout.setEncoding('utf8').on('data', (d: string) => { stdout += d; });
    child.stderr.setEncoding('utf8').on('data', (d: string) => { stderr += d; });
    child.on('error', (e) => finish(() => reject(e)));
    child.on('close', (code) => finish(() => resolve({ stdout, stderr, code })));
    child.stdin.end();
  });
}
