import { chmodSync, mkdtempSync, rmSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OcError } from '@weave-ai/shared';

const logSpy = { info: vi.fn(), warn: vi.fn() };
vi.mock('@weave-ai/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@weave-ai/core')>();
  return { ...actual, getLogger: () => logSpy };
});

const { analyzeWav, createVoxtypeProbe, extractVoxtypeTranscript, parseVoxtypeModelsJson, resolveVoxtypeModel } = await import('../src/voxtype.js');

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  logSpy.info.mockClear();
  logSpy.warn.mockClear();
});

/** A minimal 16-bit PCM WAV, the shape `wav.ts` always produces on the client. */
function makeWav(samples: number[], opts: { sampleRate?: number; channels?: number } = {}): Buffer {
  const sampleRate = opts.sampleRate ?? 16000;
  const channels = opts.channels ?? 1;
  const data = Buffer.alloc(samples.length * 2);
  samples.forEach((s, i) => data.writeInt16LE(Math.max(-0x8000, Math.min(0x7fff, Math.round(s * 0x7fff))), i * 2));
  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * channels * 2, 28);
  header.writeUInt16LE(channels * 2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

const MODELS_JSON = JSON.stringify({
  engines: {
    whisper: {
      default: 'base.en',
      models: [
        { name: 'tiny.en', installed: true },
        { name: 'base.en', installed: true },
        { name: 'small.en', installed: false },
      ],
    },
  },
});

const CAPTAIN_STDOUT = `Loading audio file: "/tmp/ac-voxtype-NR76L8/dictation.wav"
Audio format: 16000 Hz, 1 channel(s), Int
Processing 113322 samples (7.08s)...
INFO Using local whisper transcription mode
INFO Loading whisper model from ".../ggml-large-v3-turbo.bin"
INFO Model loaded in 0.36s
INFO Transcription completed in 2.24s: "Does this actually work? I mean, that's pretty coo..."

Does this actually work? I mean, that's pretty cool if it does, but I don't know.
`;
const CAPTAIN_TRANSCRIPT = "Does this actually work? I mean, that's pretty cool if it does, but I don't know.";

/** VS-196: the 2026-09-10 report — Voxtype's own retry produced "." twice, then gave up. */
const DEGENERATE_STDOUT = `INFO Using local whisper transcription mode
INFO Loading whisper model from "/home/user/.local/share/voxtype/models/ggml-large-v3-turbo.bin"
INFO Model loaded in 0.51s
WARN Whisper returned degenerate transcript "." for 4.18s audio; retrying with beam search
WARN Whisper retry also returned degenerate transcript "."; treating as empty
INFO Transcription completed in 2.51s: ""
`;

/** VS-219: verbatim stdout captured 2026-09-11 from the daemon host, voxtype 1.0.1,
 *  `voxtype --model large-v3-turbo transcribe <2s 16kHz mono wav>`, stdout redirected (non-TTY).
 *  The log lines begin with ISO-8601 timestamps and carry ANSI — the shape VS-186's `^`-anchored
 *  filter never matched, which is how log lines reached the composer. A 2s tone transcribes
 *  degenerate-empty, so the transcript paragraph is absent and stdout ends in two blank lines. */
const TIMESTAMPED_STDOUT = `Loading audio file: "/tmp/opencode/vs219/tone.wav"
Audio format: 16000 Hz, 1 channel(s), Int
Processing 32000 samples (2.00s)...
\x1B[2m2026-09-11T02:10:53.635895Z\x1B[0m \x1B[32m INFO\x1B[0m Using local whisper transcription mode
\x1B[2m2026-09-11T02:10:53.635907Z\x1B[0m \x1B[32m INFO\x1B[0m Loading whisper model from "/home/user/.local/share/voxtype/models/ggml-large-v3-turbo.bin"
\x1B[2m2026-09-11T02:10:53.936088Z\x1B[0m \x1B[32m INFO\x1B[0m Model loaded in 0.30s
\x1B[2m2026-09-11T02:10:54.050790Z\x1B[0m \x1B[33m WARN\x1B[0m Whisper returned degenerate transcript "." for 2.00s audio; retrying with beam search
\x1B[2m2026-09-11T02:10:54.166277Z\x1B[0m \x1B[33m WARN\x1B[0m Whisper retry also returned degenerate transcript "."; treating as empty
\x1B[2m2026-09-11T02:10:54.166289Z\x1B[0m \x1B[32m INFO\x1B[0m Transcription completed in 0.23s: ""


`;

/** VS-219: verbatim stdout of the same capture run with `-q` (voxtype 1.0.1, 2026-09-11). The
 *  timestamped log lines are gone; these three progress lines are what `-q` still prints. */
const QUIET_STDOUT = `Loading audio file: "/tmp/opencode/vs219/tone.wav"
Audio format: 16000 Hz, 1 channel(s), Int
Processing 32000 samples (2.00s)...


`;

/** VS-219: the captain's 2026-09-11 incident paste, verbatim — the four lines that reached the
 *  composer above the dictated words; the last quotes the transcript (truncated by the CLI). */
const CAPTAIN_2026_09_11 = `2026-09-11T02:03:05.793763Z  INFO Using local whisper transcription mode
2026-09-11T02:03:05.793780Z  INFO Loading whisper model from "/home/user/.local/share/voxtype/models/ggml-large-v3-turbo.bin"
2026-09-11T02:03:06.384936Z  INFO Model loaded in 0.59s
2026-09-11T02:03:07.595114Z  INFO Transcription completed in 1.21s: "I got another idea and I think it would be interes..."
`;

function fakeBin(kind: 'models' | 'transcribe' | 'logs' | 'degenerate' | 'fail' | 'hang' | 'argv' | 'quietTranscript'): string {
  const dir = mkdtempSync(join(tmpdir(), 'ac-fake-voxtype-'));
  dirs.push(dir);
  const path = join(dir, 'voxtype');
  const script = {
    models: `process.stdout.write(${JSON.stringify(MODELS_JSON)});`,
    transcribe: `const a=process.argv.slice(2); if(a[0]==='-q'&&a[1]==='--model'){process.stdout.write('ok:'+a[2]+'\\n'); process.exit(0)} process.exit(1);`,
    logs: `process.stdout.write(${JSON.stringify(CAPTAIN_STDOUT)});`,
    degenerate: `process.stdout.write(${JSON.stringify(DEGENERATE_STDOUT)});`,
    fail: `process.stderr.write('boom'); process.exit(2);`,
    hang: `setTimeout(()=>{}, 30000);`,
    argv: `process.stdout.write(JSON.stringify(process.argv.slice(2)));`,
    quietTranscript: `process.stdout.write(${JSON.stringify(QUIET_STDOUT + 'Hello there from dictation.\n')});`,
  }[kind];
  writeFileSync(path, `#!/usr/bin/env node\n${script}\n`);
  chmodSync(path, 0o755);
  return path;
}

describe('parseVoxtypeModelsJson', () => {
  it('flattens engines into id/engine/installed', () => {
    const models = parseVoxtypeModelsJson(MODELS_JSON);
    expect(models).toEqual([
      { id: 'tiny.en', engine: 'whisper', installed: true },
      { id: 'base.en', engine: 'whisper', installed: true },
      { id: 'small.en', engine: 'whisper', installed: false },
    ]);
  });

  it('returns [] on junk', () => {
    expect(parseVoxtypeModelsJson('nope')).toEqual([]);
    expect(parseVoxtypeModelsJson('{}')).toEqual([]);
  });
});

describe('extractVoxtypeTranscript', () => {
  it('returns only the spoken paragraph from the 2026-09-10 captain fixture', () => {
    expect(extractVoxtypeTranscript(CAPTAIN_STDOUT)).toBe(CAPTAIN_TRANSCRIPT);
  });

  it('leaves transcript-only stdout unchanged', () => {
    expect(extractVoxtypeTranscript(`${CAPTAIN_TRANSCRIPT}\n`)).toBe(CAPTAIN_TRANSCRIPT);
  });

  it('drops ANSI-wrapped INFO lines', () => {
    const raw = `\x1B[32mINFO Using local whisper transcription mode\x1B[0m\n${CAPTAIN_TRANSCRIPT}\n`;
    expect(extractVoxtypeTranscript(raw)).toBe(CAPTAIN_TRANSCRIPT);
  });

  it('returns empty for the 2026-09-11 timestamped host capture — the shape that defeated VS-186 (VS-219)', () => {
    const text = extractVoxtypeTranscript(TIMESTAMPED_STDOUT);
    expect(text).toBe('');
    expect(text).not.toMatch(/INFO|WARN|samples|Loading whisper/);
    expect(text).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
  });

  it('returns empty for the 2026-09-11 `-q` capture whose three progress lines survive quiet mode (VS-219)', () => {
    expect(extractVoxtypeTranscript(QUIET_STDOUT)).toBe('');
  });

  it('returns empty for the captain\u2019s verbatim 2026-09-11 incident paste (VS-219)', () => {
    const text = extractVoxtypeTranscript(CAPTAIN_2026_09_11);
    expect(text).toBe('');
    expect(text).not.toContain('I got another idea');
  });
});

describe('analyzeWav', () => {
  it('measures a silent wav as zero peak and rms', () => {
    const wav = makeWav(new Array(1600).fill(0), { sampleRate: 16000 });
    expect(analyzeWav(wav)).toEqual({
      sampleRate: 16000,
      channels: 1,
      bitsPerSample: 16,
      durationSec: 0.1,
      peakAmplitude: 0,
      rms: 0,
    });
  });

  it('measures a full-scale tone as nonzero peak and rms, with the right duration', () => {
    const samples = Array.from({ length: 16000 }, (_, i) => Math.sin((2 * Math.PI * 440 * i) / 16000));
    const wav = makeWav(samples, { sampleRate: 16000 });
    const analysis = analyzeWav(wav)!;
    expect(analysis.durationSec).toBeCloseTo(1, 5);
    expect(analysis.peakAmplitude).toBeGreaterThan(0.9);
    expect(analysis.rms).toBeGreaterThan(0.5);
  });

  it('reports the declared sample rate and channel count from the header', () => {
    const wav = makeWav(new Array(200).fill(0.1), { sampleRate: 48000, channels: 2 });
    expect(analyzeWav(wav)).toMatchObject({ sampleRate: 48000, channels: 2, durationSec: 100 / 48000 });
  });

  it('returns null for bytes that are not a wav', () => {
    expect(analyzeWav(Buffer.from('not a wav file at all'))).toBeNull();
  });

  it('returns null for a truncated header', () => {
    expect(analyzeWav(Buffer.from('RIFF'))).toBeNull();
  });
});

describe('resolveVoxtypeModel', () => {
  const status = { installed: true, models: parseVoxtypeModelsJson(MODELS_JSON) };

  it('keeps a requested installed id', () => {
    expect(resolveVoxtypeModel('tiny.en', status)).toBe('tiny.en');
  });

  it('falls back to the first installed model', () => {
    expect(resolveVoxtypeModel('small.en', status)).toBe('tiny.en');
    expect(resolveVoxtypeModel(undefined, status)).toBe('tiny.en');
  });
});

describe('VoxtypeProbe', () => {
  it('reports missing binary without throwing', async () => {
    const probe = createVoxtypeProbe({ binary: join(tmpdir(), 'no-such-voxtype-binary') });
    const st = await probe.status();
    expect(st.installed).toBe(false);
    expect(st.models).toEqual([]);
    expect(st.error).toMatch(/not installed|ENOENT/i);
  });

  it('parses installed models from a fake binary', async () => {
    const st = await createVoxtypeProbe({ binary: fakeBin('models') }).status();
    expect(st.installed).toBe(true);
    expect(st.models.filter((m) => m.installed).map((m) => m.id)).toEqual(['tiny.en', 'base.en']);
  });

  it('treats a failing spawn as not installed, not a throw', async () => {
    const st = await createVoxtypeProbe({ binary: fakeBin('fail') }).status();
    expect(st.installed).toBe(false);
    expect(st.error).toBeTruthy();
  });

  it('transcribes a wav via the fake binary and deletes the temp file', async () => {
    const before = new Set(readdirSync(tmpdir()).filter((n) => n.startsWith('ac-voxtype-')));
    const text = await createVoxtypeProbe({ binary: fakeBin('transcribe') }).transcribe(Buffer.from('RIFF'), 'base.en');
    expect(text).toBe('ok:base.en');
    const leftover = readdirSync(tmpdir()).filter((n) => n.startsWith('ac-voxtype-') && !before.has(n));
    expect(leftover.every((n) => !existsSync(join(tmpdir(), n)))).toBe(true);
  });

  it('spawns voxtype with -q before the subcommand, with and without a model (VS-219)', async () => {
    const probe = createVoxtypeProbe({ binary: fakeBin('argv') });
    const withModel = JSON.parse(await probe.transcribe(Buffer.from('RIFF'), 'base.en'));
    expect(withModel).toEqual(['-q', '--model', 'base.en', 'transcribe', expect.stringContaining('dictation.wav')]);
    const withoutModel = JSON.parse(await probe.transcribe(Buffer.from('RIFF'), undefined));
    expect(withoutModel).toEqual(['-q', 'transcribe', expect.stringContaining('dictation.wav')]);
  });

  it('returns only the spoken paragraph from verbatim `-q` stdout plus one (VS-219)', async () => {
    const wav = makeWav(new Array(1600).fill(0.5), { sampleRate: 16000 });
    const text = await createVoxtypeProbe({ binary: fakeBin('quietTranscript') }).transcribe(wav, 'base.en');
    expect(text).toBe('Hello there from dictation.');
    expect(text).not.toMatch(/Loading audio file|Audio format|samples/);
  });

  it('returns only the spoken paragraph when the fake binary prints the captain fixture', async () => {
    const text = await createVoxtypeProbe({ binary: fakeBin('logs') }).transcribe(Buffer.from('RIFF'), 'base.en');
    expect(text).toBe(CAPTAIN_TRANSCRIPT);
    expect(text).not.toMatch(/ac-voxtype-/);
    expect(text).not.toMatch(/\bINFO\b/);
    expect(text).not.toMatch(/samples/);
  });

  it('logs the measured audio and does not warn when a transcript comes back', async () => {
    const wav = makeWav(new Array(1600).fill(0.5), { sampleRate: 16000 });
    await createVoxtypeProbe({ binary: fakeBin('logs') }).transcribe(wav, 'base.en');
    expect(logSpy.info).toHaveBeenCalledWith(
      expect.objectContaining({ analysis: expect.objectContaining({ sampleRate: 16000, channels: 1 }) }),
      'voxtype transcribe input audio',
    );
    expect(logSpy.warn).not.toHaveBeenCalled();
  });

  it('warns with the measured audio and voxtype stdout when the transcript comes back empty (VS-196)', async () => {
    const wav = makeWav(new Array(1600).fill(0), { sampleRate: 16000 });
    const text = await createVoxtypeProbe({ binary: fakeBin('degenerate') }).transcribe(wav, 'base.en');
    expect(text).toBe('');
    expect(logSpy.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        analysis: expect.objectContaining({ sampleRate: 16000, channels: 1, peakAmplitude: 0 }),
        stdout: expect.stringContaining('degenerate transcript'),
      }),
      'voxtype transcribe returned an empty transcript',
    );
  });

  it('kills a hanging binary', async () => {
    const probe = createVoxtypeProbe({ binary: fakeBin('hang'), timeoutMs: 200 });
    await expect(probe.transcribe(Buffer.from('RIFF'), 'base.en')).rejects.toBeInstanceOf(OcError);
  });
});
