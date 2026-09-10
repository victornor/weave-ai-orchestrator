import { chmodSync, mkdtempSync, rmSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { OcError } from '@agent-conductor/shared';
import { createVoxtypeProbe, extractVoxtypeTranscript, parseVoxtypeModelsJson, resolveVoxtypeModel } from '../src/voxtype.js';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

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

function fakeBin(kind: 'models' | 'transcribe' | 'logs' | 'fail' | 'hang'): string {
  const dir = mkdtempSync(join(tmpdir(), 'ac-fake-voxtype-'));
  dirs.push(dir);
  const path = join(dir, 'voxtype');
  const script = {
    models: `process.stdout.write(${JSON.stringify(MODELS_JSON)});`,
    transcribe: `const a=process.argv.slice(2); if(a[0]==='--model'){process.stdout.write('ok:'+a[1]+'\\n'); process.exit(0)} process.exit(1);`,
    logs: `process.stdout.write(${JSON.stringify(CAPTAIN_STDOUT)});`,
    fail: `process.stderr.write('boom'); process.exit(2);`,
    hang: `setTimeout(()=>{}, 30000);`,
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

  it('returns only the spoken paragraph when the fake binary prints the captain fixture', async () => {
    const text = await createVoxtypeProbe({ binary: fakeBin('logs') }).transcribe(Buffer.from('RIFF'), 'base.en');
    expect(text).toBe(CAPTAIN_TRANSCRIPT);
    expect(text).not.toMatch(/ac-voxtype-/);
    expect(text).not.toMatch(/\bINFO\b/);
    expect(text).not.toMatch(/samples/);
  });

  it('kills a hanging binary', async () => {
    const probe = createVoxtypeProbe({ binary: fakeBin('hang'), timeoutMs: 200 });
    await expect(probe.transcribe(Buffer.from('RIFF'), 'base.en')).rejects.toBeInstanceOf(OcError);
  });
});
