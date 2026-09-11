import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  _resetModelsCacheForTests, deriveLabel, FALLBACK_MODELS, listModels, parseListModelsOutput, parseUnknownModelRejection,
} from '../src/models.js';
import { writeFakeCursorCliListModels } from './fakeCli.js';

const dirs: string[] = [];
const tmp = (p: string) => { const d = mkdtempSync(join(tmpdir(), p)); dirs.push(d); return d; };
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); _resetModelsCacheForTests(); });

const OLD_FICTIONAL_IDS = ['grok-4-6', 'opus-5', 'composer-5-6', 'fable-5-1', 'gpt-5', 'sonnet-4-thinking'];

const TICKET_REJECTION = `Cannot use this model: grok-4-6. Available models: auto, gpt-5.3-codex-low,
gpt-5.3-codex-low-fast, gpt-5.3-codex, gpt-5.3-codex-fast, gpt-5.3-codex-high,
gpt-5.3-codex-high-fast, gpt-5.3-codex-xhigh, gpt-5.3-codex-xhigh-fast, gpt-5.2,
cursor-grok-4.6-high-fast, composer-2.5, claude-opus-5-thinking-high,
claude-opus-5-thinking-high-fast, gpt-5.6-sol-high, gpt-5.6-sol-high-fast,
gpt-5.6-sol-xhigh, ...`;

describe('deriveLabel', () => {
  it('labels a known id with its family and variants', () => {
    expect(deriveLabel('cursor-grok-4.6-high-fast')).toContain('Grok 4.6');
  });

  it('humanizes an unrecognized id instead of returning it raw', () => {
    const label = deriveLabel('banana-9000-turbo');
    expect(label.length).toBeGreaterThan(0);
    expect(label).not.toBe('banana-9000-turbo');
  });
});

describe('parseListModelsOutput', () => {
  it('parses id - displayName (current, default) lines, stopping at the Tip footer', () => {
    const text = [
      'Available models',
      '',
      'auto - Auto (current, default)',
      'gpt-5.2 - GPT-5.2',
      'cursor-grok-4.6-high-fast',
      '',
      "Tip: use --model <id> (or /model <id> in interactive mode) to switch.",
      'gpt-5.6-sol-xhigh - should not be reached',
    ].join('\n');
    const models = parseListModelsOutput(text);
    expect(models.map((m) => m.id)).toEqual(['auto', 'gpt-5.2', 'cursor-grok-4.6-high-fast']);
    expect(models.every((m) => m.source === 'detected')).toBe(true);
  });

  it('strips ANSI color codes before parsing', () => {
    const text = 'Available models\n\n[32mauto[0m - [1mAuto (current)[0m\nTip: use --model.';
    expect(parseListModelsOutput(text).map((m) => m.id)).toEqual(['auto']);
  });

  it('returns an empty list (never throws) when nothing parses', () => {
    expect(parseListModelsOutput('')).toEqual([]);
    expect(parseListModelsOutput('Available models\n\nTip: use --model.')).toEqual([]);
  });
});

describe('parseUnknownModelRejection', () => {
  it('parses the exact truncated rejection from the ticket', () => {
    const result = parseUnknownModelRejection(TICKET_REJECTION);
    expect(result?.requested).toBe('grok-4-6');
    expect(result?.available).toContain('auto');
    expect(result?.available).toContain('cursor-grok-4.6-high-fast');
    expect(result?.available).not.toContain('...');
  });

  it('parses a non-truncated single-line rejection', () => {
    const result = parseUnknownModelRejection('Cannot use this model: nope. Available models: auto, gpt-5.2');
    expect(result).toEqual({ requested: 'nope', available: ['auto', 'gpt-5.2'] });
  });

  it('returns null for unrelated text', () => {
    expect(parseUnknownModelRejection('some other error')).toBeNull();
  });
});

describe('FALLBACK_MODELS', () => {
  it('contains only ids confirmed real, never the old invented ones', () => {
    const ids = FALLBACK_MODELS.map((m) => m.id);
    expect(ids).toContain('auto');
    for (const bad of OLD_FICTIONAL_IDS) expect(ids).not.toContain(bad);
    expect(FALLBACK_MODELS.every((m) => m.source === 'static')).toBe(true);
  });
});

describe('listModels dynamic detection', () => {
  it('falls back to the static list when no binary is given, without spawning', async () => {
    const models = await listModels({ binaryPath: null });
    expect(models.map((m) => m.id)).toEqual(FALLBACK_MODELS.map((m) => m.id));
    expect(models.every((m) => m.source === 'static')).toBe(true);
    expect(models.every((m) => Array.isArray(m.efforts) && m.efforts.length === 0)).toBe(true);
  });

  it('parses a real fake-CLI --list-models response and tags it detected', async () => {
    const dir = writeFakeCursorCliListModels({ stdout: 'Available models\n\nauto - Auto (current, default)\ncomposer-2.5 - Composer 2.5\n\nTip: use --model.' });
    const models = await listModels({ binaryPath: join(dir, 'cursor-agent') });
    expect(models.map((m) => m.id)).toEqual(['auto', 'composer-2.5']);
    expect(models.every((m) => m.source === 'detected')).toBe(true);
    expect(models.every((m) => Array.isArray(m.efforts) && m.efforts.length === 0)).toBe(true);
  });

  it('falls back to the static list, with a warn log, when the CLI exits non-zero', async () => {
    const dir = writeFakeCursorCliListModels({ exitCode: 1, stderr: 'Authentication required' });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const models = await listModels({ binaryPath: join(dir, 'cursor-agent') });
    expect(models.map((m) => m.id)).toEqual(FALLBACK_MODELS.map((m) => m.id));
    expect(models.every((m) => m.source === 'static')).toBe(true);
    expect(warn).toHaveBeenCalled();
    expect(String(warn.mock.calls[0]?.[0])).toContain('Authentication required');
    warn.mockRestore();
  });

  it('caches a result so a second in-window call does not respawn', async () => {
    const countFile = join(tmp('ac-cursor-count-'), 'count');
    const dir = writeFakeCursorCliListModels({ stdout: 'auto\n', countFile });
    const path = join(dir, 'cursor-agent');
    await listModels({ binaryPath: path });
    await listModels({ binaryPath: path });
    expect(existsSync(countFile) ? readFileSync(countFile, 'utf8').length : 0).toBe(1);
  });

  it('respawns once the cache is reset (simulating TTL expiry)', async () => {
    const countFile = join(tmp('ac-cursor-count-'), 'count');
    const dir = writeFakeCursorCliListModels({ stdout: 'auto\n', countFile });
    const path = join(dir, 'cursor-agent');
    await listModels({ binaryPath: path });
    _resetModelsCacheForTests();
    await listModels({ binaryPath: path });
    expect(readFileSync(countFile, 'utf8').length).toBe(2);
  });
});
