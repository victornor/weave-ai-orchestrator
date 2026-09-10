import { chmodSync, mkdtempSync, rmSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { OcError } from '@agent-conductor/shared';
import { createVoxtypeProbe, parseVoxtypeModelsJson, resolveVoxtypeModel } from '../src/voxtype.js';

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

function fakeBin(kind: 'models' | 'transcribe' | 'fail' | 'hang'): string {
  const dir = mkdtempSync(join(tmpdir(), 'ac-fake-voxtype-'));
  dirs.push(dir);
  const path = join(dir, 'voxtype');
  const script = {
    models: `process.stdout.write(${JSON.stringify(MODELS_JSON)});`,
    transcribe: `const a=process.argv.slice(2); if(a[0]==='--model'){process.stdout.write('ok:'+a[1]+'\\n'); process.exit(0)} process.exit(1);`,
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

  it('kills a hanging binary', async () => {
    const probe = createVoxtypeProbe({ binary: fakeBin('hang'), timeoutMs: 200 });
    await expect(probe.transcribe(Buffer.from('RIFF'), 'base.en')).rejects.toBeInstanceOf(OcError);
  });
});
