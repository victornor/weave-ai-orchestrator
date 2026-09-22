import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { adapter, readProviderError } from '../src/adapter.js';

const dirs: string[] = [];
const tmp = (p: string) => { const d = mkdtempSync(join(tmpdir(), p)); dirs.push(d); return d; };
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

/** `skills/manifest.json`'s `runtimes.<id>.path` is `<skillsDir>/<name>/SKILL.md`; strip the suffix. */
const skillsDirFromManifest = (runtimeId: string): string => {
  const manifestPath = fileURLToPath(new URL('../../../../skills/manifest.json', import.meta.url));
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { runtimes: Record<string, { path: string }> };
  const path = manifest.runtimes[runtimeId]?.path;
  if (!path) throw new Error(`skills/manifest.json has no runtimes.${runtimeId} entry`);
  return path.replace(/\/<name>\/SKILL\.md$/, '');
};

describe('opencode adapter', () => {
  it('declares no native structured output', () => {
    expect(adapter.id).toBe('opencode');
    expect(adapter.skillsDir()).toBe('.opencode/skills');
    expect(adapter.instructionFiles()).toEqual(['AGENTS.md']);
    expect(adapter.capabilities).toMatchObject({ structuredOutput: false, systemPromptInjection: 'file_only', mcp: true });
    expect(adapter.capabilities.imageInput).toBe('path');
  });

  it('declares the partial output the page is told about (VS-595)', () => {
    expect(adapter.capabilities.partialOutput).toBe('full');
  });

  it('detects models from `opencode models`, falling back to a static list', async () => {
    const models = await adapter.listModels();
    expect(models.length).toBeGreaterThan(0);
    expect(models.every((m) => m.id.includes('/'))).toBe(true);
    expect(['detected', 'static']).toContain(models[0]!.source);
    if (models[0]!.source === 'static') {
      expect(models.every((m) => m.efforts === undefined)).toBe(true);
    }
  });

  it('installs AGENTS.md, skills and a placeholder opencode.json', async () => {
    const home = tmp('ac-home-'); const skill = tmp('ac-skill-');
    writeFileSync(join(skill, 'SKILL.md'), '# demo\n');
    await adapter.installInstructions({ path: home, kind: 'worker' }, { instructions: '# Charter\n', skills: [{ name: 'demo', dir: skill }] });
    expect(readFileSync(join(home, 'AGENTS.md'), 'utf8')).toBe('# Charter\n');
    expect(readFileSync(join(home, '.opencode/skills/demo/SKILL.md'), 'utf8')).toContain('demo');
    expect(JSON.parse(readFileSync(join(home, '.opencode/opencode.json'), 'utf8')).$schema).toBe('https://opencode.ai/config.json');
  });

  it('installs skills at the path skills/manifest.json declares for opencode (VS-189)', async () => {
    expect(adapter.skillsDir()).toBe(skillsDirFromManifest('opencode'));
    const home = tmp('ac-home-'); const skill = tmp('ac-skill-');
    writeFileSync(join(skill, 'SKILL.md'), '# demo\n');
    await adapter.installInstructions({ path: home, kind: 'worker' }, { instructions: '# Charter\n', skills: [{ name: 'demo', dir: skill }] });
    expect(readFileSync(join(home, skillsDirFromManifest('opencode'), 'demo', 'SKILL.md'), 'utf8')).toContain('demo');
  });

  it('detects the installed binary', async () => {
    expect(['available', 'missing_binary', 'broken']).toContain((await adapter.detect()).status);
  });

  // VS-461: the line is copied from the live log during the 2026-09-14 DeepSeek outage; opencode
  // retried it silently, so only this file carried it. Only the bytes appended since the turn
  // started are read, and only the turn's own session counts.
  it('reads the provider error its CLI logged for the turn\'s session, from the bytes the turn appended', () => {
    const SESSION = 'ses_f5edbbd24ffeQj03OjwcFApn8m';
    const line = (sid: string, at: string, msg: string): string =>
      `timestamp=${at} level=ERROR run=abc message="stream error" providerID=deepseek modelID=deepseek-flash `
      + `session.id=${sid} small=false agent=build mode=primary error.error.message="${msg}"`;
    const logPath = join(tmp('ac-log-'), 'opencode', 'log', 'opencode.log');
    mkdirSync(dirname(logPath), { recursive: true });
    // A previous, different session's error sits before this turn's offset and must not be read.
    writeFileSync(logPath, `${line('ses_earlier', '2026-09-14T18:30:00.000Z', 'older failure')}\n`);
    const offset = statSync(logPath).size;
    writeFileSync(logPath, `${line(SESSION, '2026-09-14T18:46:51.593Z', 'We were unable to start processing your request within the 900-second timeout limit. Please try again later.')}\n`, { flag: 'a' });

    const found = readProviderError(logPath, offset, SESSION);
    expect(found).toMatchObject({ sessionId: SESSION, provider: 'deepseek', model: 'deepseek-flash' });
    expect(found!.message).toContain('900-second timeout');
    // A concurrent session sharing the log is never attributed to this turn, and a turn that
    // appended nothing reads nothing.
    expect(readProviderError(logPath, offset, 'ses_other')).toBeNull();
    expect(readProviderError(logPath, statSync(logPath).size, SESSION)).toBeNull();
  });
}, 90_000);

// VS-573: opencode exited 0 after a `tool-calls` step (run 01M2TNG49HM35TZ1GXEGKPHA8Y). A fake
// `opencode` on PATH replays a recorded stream; nothing here launches the real CLI.
describe('opencode runTurn ending', () => {
  const fixture = (name: string): string => fileURLToPath(new URL(`../fixtures/${name}.jsonl`, import.meta.url));
  async function turn(name: string) {
    const bin = tmp('ac-bin-'); const cwd = tmp('ac-cwd-'); const configHome = tmp('ac-cfg-');
    writeFileSync(join(bin, 'opencode'), `#!/bin/sh\ncat ${fixture(name)}\nexit 0\n`);
    chmodSync(join(bin, 'opencode'), 0o755);
    return adapter.runTurn({
      runId: 'r', turnEpoch: 1, cwd, worktree: null, session: { policy: 'reuse', ref: null, isFirstTurn: true },
      systemPrompt: { text: '', mode: 'skip' }, prompt: 'hi', mcpServers: {},
      env: { PATH: `${bin}:${process.env['PATH'] ?? ''}` }, options: {}, limits: { timeoutMs: 30_000 },
      permission: { mode: 'auto' }, model: 'xai/grok-4.6', configHome,
    } as never, { onSpawn() {}, onEvent() {}, onRaw() {} });
  }

  it('reports incomplete_turn, a retryable family, when the stream ends on tool-calls', async () => {
    const r = await turn('turn-cut-off');
    expect(r.exitCode).toBe(0);
    expect(r.error).toMatchObject({ code: 'incomplete_turn', family: 'transient_upstream' });
  });

  it('leaves a turn that ended on stop successful', async () => {
    const r = await turn('turn-simple');
    expect(r.error).toBeUndefined();
    expect(r.finalText).toBe('pong');
  });
});
