import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { FALLBACK_MODELS, listModels, parseBundledModels } from '../src/models.js';
import { writeFakeCodexCli } from './fakeCli.js';

const bundled = readFileSync(fileURLToPath(new URL('./fixtures/debug-models-bundled.json', import.meta.url)), 'utf8');

describe('parseBundledModels — captured `codex debug models --bundled` shape (2026-09-11, 0.153.4)', () => {
  it('reads slug and supported_reasoning_levels[].effort, not supportedReasoningEfforts', () => {
    const models = parseBundledModels(bundled);
    expect(models.length).toBeGreaterThan(0);
    expect(models.every((m) => m.source === 'detected')).toBe(true);
    const astra = models.find((m) => m.id === 'gpt-6-astra');
    expect(astra?.label).toBe('GPT-6-Astra');
    expect(astra?.efforts).toEqual(['low', 'medium', 'high', 'xhigh', 'max', 'ultra']);
    const gpt52 = models.find((m) => m.id === 'gpt-5.2');
    expect(gpt52?.efforts).toEqual(['low', 'medium', 'high', 'xhigh']);
    expect(JSON.parse(bundled).models[0].supportedReasoningEfforts).toBeUndefined();
  });

  it('returns [] for unparseable stdout', () => {
    expect(parseBundledModels('not json')).toEqual([]);
    expect(parseBundledModels('{"nope":[]}')).toEqual([]);
  });
});

describe('listModels', () => {
  it('omits efforts on the static fallback when no binary is given, never applying minimal|low|medium|high to every row', async () => {
    const models = await listModels({ binaryPath: null });
    expect(models.map((m) => m.id)).toEqual(FALLBACK_MODELS.map((m) => m.id));
    expect(models.every((m) => m.source === 'static')).toBe(true);
    expect(models.every((m) => m.efforts === undefined)).toBe(true);
  });

  it('tags detected efforts from a fake CLI that prints the captured dump', async () => {
    const dir = writeFakeCodexCli({ stdout: bundled });
    const models = await listModels({ binaryPath: join(dir, 'codex') });
    expect(models[0]!.source).toBe('detected');
    expect(models.find((m) => m.id === 'gpt-6-astra')?.efforts).toContain('ultra');
  });

  it('falls back to static ids with efforts omitted when the CLI exits non-zero', async () => {
    const dir = writeFakeCodexCli({ exitCode: 1, stderr: 'nope' });
    const models = await listModels({ binaryPath: join(dir, 'codex') });
    expect(models.every((m) => m.source === 'static' && m.efforts === undefined)).toBe(true);
  });
});
