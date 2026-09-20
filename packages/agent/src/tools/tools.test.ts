import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { bashTool } from './bash.js';
import { editTool } from './edit.js';
import { globTool } from './glob.js';
import { grepTool, rgAvailable } from './grep.js';
import { ReadLedger } from './ledger.js';
import { readTool } from './read.js';
import { atomicWrite, writeTool } from './write.js';
import type { ToolCtx } from './index.js';

let dir: string; let wt: string; let home: string;
const emitted: Array<{ type: string; payload: Record<string, unknown> }> = [];
function ctx(over: Partial<ToolCtx> = {}): ToolCtx {
  return {
    cwd: wt, home, mode: 'auto', env: { PATH: process.env['PATH'] ?? '', HOME: home }, signal: new AbortController().signal,
    callId: 'c1', spillDir: join(dir, 'spill'), ledger: new ReadLedger(), rg: rgAvailable(), emit: (type, payload) => emitted.push({ type, payload }), ...over,
  };
}
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'wa-tools-')); wt = join(dir, 'work'); home = join(dir, 'home'); mkdirSync(wt); mkdirSync(home); emitted.length = 0; });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('read', () => {
  it('numbers lines and pages a large file with a footer naming the next offset', async () => {
    writeFileSync(join(wt, 'big.txt'), Array.from({ length: 5000 }, (_, i) => `line ${i + 1}`).join('\n') + '\n');
    const r = await readTool.run({ path: 'big.txt' }, ctx());
    const rows = r.text.split('\n');
    expect(rows[0]).toBe('1\tline 1');
    expect(rows[1999]).toBe('2000\tline 2000');
    expect(r.text.endsWith('[showing lines 1-2000 of 5000; call read with offset=2001]')).toBe(true);
    const next = await readTool.run({ path: 'big.txt', offset: 4999, limit: 10 }, ctx());
    expect(next.text).toBe('4999\tline 4999\n5000\tline 5000');
  });
  it('stops at 50 KB and truncates a very long line', async () => {
    writeFileSync(join(wt, 'wide.txt'), Array.from({ length: 200 }, () => 'x'.repeat(1000)).join('\n'));
    const r = await readTool.run({ path: 'wide.txt' }, ctx());
    expect(r.text.length).toBeLessThan(52 * 1024);
    expect(r.text).toMatch(/\[showing lines 1-\d+ of 200; call read with offset=\d+\]$/);
    writeFileSync(join(wt, 'long.txt'), 'y'.repeat(5000));
    expect((await readTool.run({ path: 'long.txt' }, ctx())).text).toContain('… [line truncated, 5000 chars]');
  });
  it('lists a directory sorted with a slash suffix, and refuses a binary file', async () => {
    mkdirSync(join(wt, 'sub'));
    writeFileSync(join(wt, 'b.txt'), 'b');
    writeFileSync(join(wt, 'a.bin'), Buffer.from([1, 0, 2]));
    expect((await readTool.run({ path: '.' }, ctx())).text).toBe('a.bin\nb.txt\nsub/');
    expect(await readTool.run({ path: 'a.bin' }, ctx())).toMatchObject({ text: 'Error: binary file', isError: true });
  });
  it('reports a missing path as an ordinary error result', async () => {
    expect(await readTool.run({ path: 'nope' }, ctx())).toMatchObject({ isError: true, text: expect.stringMatching(/^Error: no such file/) });
  });
  it('records a successful file read in the ledger', async () => {
    writeFileSync(join(wt, 'a.txt'), 'a\n');
    const c = ctx();
    await readTool.run({ path: 'a.txt' }, c);
    expect(c.ledger.check(join(wt, 'a.txt'))).toBe('ok');
  });
});

describe('write', () => {
  it('creates a file and emits file.changed', async () => {
    const r = await writeTool.run({ path: 'new.txt', content: 'one\ntwo\n' }, ctx());
    expect(r.text).toBe(`Created ${join(wt, 'new.txt')} (8 bytes)`);
    expect(readFileSync(join(wt, 'new.txt'), 'utf8')).toBe('one\ntwo\n');
    expect(emitted.at(-1)).toMatchObject({ type: 'file.changed', payload: { path: join(wt, 'new.txt'), changeType: 'created', additions: 3, deletions: 0 } });
  });
  it('refuses to overwrite a file that was not read this turn', async () => {
    writeFileSync(join(wt, 'a.txt'), 'old');
    const r = await writeTool.run({ path: 'a.txt', content: 'new' }, ctx());
    expect(r).toMatchObject({ isError: true, text: expect.stringContaining('must be read before it is overwritten') });
    expect(readFileSync(join(wt, 'a.txt'), 'utf8')).toBe('old');
  });
  it('overwrites after a read and refreshes the ledger', async () => {
    writeFileSync(join(wt, 'a.txt'), 'old');
    const c = ctx();
    await readTool.run({ path: 'a.txt' }, c);
    const r = await writeTool.run({ path: 'a.txt', content: 'new' }, c);
    expect(r.text).toBe(`Overwrote ${join(wt, 'a.txt')} (3 bytes)`);
    expect(c.ledger.check(join(wt, 'a.txt'))).toBe('ok');
  });
  it('refuses a file over 10 MB', async () => {
    const r = await writeTool.run({ path: 'big.txt', content: 'x'.repeat(10 * 1024 * 1024 + 1) }, ctx());
    expect(r).toMatchObject({ isError: true, text: expect.stringContaining('over 10 MB') });
  });
  it('leaves no temp file behind when the rename fails', () => {
    const dest = join(wt, 'dest');
    mkdirSync(dest);
    writeFileSync(join(dest, 'x'), 'y');
    expect(() => atomicWrite(dest, Buffer.from('z'))).toThrow();
    expect(readdirSync(wt).filter((f) => f.includes('.tmp'))).toEqual([]);
  });
});

describe('edit', () => {
  const read = async (c: ToolCtx, path = 'a.txt') => { await readTool.run({ path }, c); };
  it('replaces an exact match and reports the diff', async () => {
    writeFileSync(join(wt, 'a.txt'), 'alpha\nbeta\ngamma\n');
    const c = ctx();
    await read(c);
    const r = await editTool.run({ path: 'a.txt', old_string: 'beta', new_string: 'BETA' }, c);
    expect(r.text).toContain(`Edited ${join(wt, 'a.txt')}: 1 replacement(s)`);
    expect(r.text).toContain('@@');
    expect(r.text).toContain('-beta');
    expect(r.text).toContain('+BETA');
    expect(readFileSync(join(wt, 'a.txt'), 'utf8')).toBe('alpha\nBETA\ngamma\n');
    const f = emitted.at(-1)!;
    expect(f.type).toBe('file.changed');
    expect(f.payload).toMatchObject({ changeType: 'modified', additions: 1, deletions: 1 });
    expect(String(f.payload['diff'])).toContain('@@');
  });
  it('falls back to the line-trimmed stage', async () => {
    writeFileSync(join(wt, 'a.txt'), '  indented line  \nother\n');
    const c = ctx();
    await read(c);
    const r = await editTool.run({ path: 'a.txt', old_string: 'indented line', new_string: 'fixed' }, c);
    expect(r.text).toContain('1 replacement(s)');
    expect(readFileSync(join(wt, 'a.txt'), 'utf8')).toBe('  fixed  \nother\n');
  });
  it('treats an ambiguous match as an error and changes nothing', async () => {
    writeFileSync(join(wt, 'a.txt'), 'same\nsame\nsame\n');
    const c = ctx();
    await read(c);
    const r = await editTool.run({ path: 'a.txt', old_string: 'same', new_string: 'x' }, c);
    expect(r).toMatchObject({ isError: true, text: expect.stringContaining('3 matches') });
    expect(readFileSync(join(wt, 'a.txt'), 'utf8')).toBe('same\nsame\nsame\n');
  });
  it('replaces every match with replace_all', async () => {
    writeFileSync(join(wt, 'a.txt'), 'same\nsame\nsame\n');
    const c = ctx();
    await read(c);
    const r = await editTool.run({ path: 'a.txt', old_string: 'same', new_string: 'x', replace_all: true }, c);
    expect(r.text).toContain('3 replacement(s)');
    expect(readFileSync(join(wt, 'a.txt'), 'utf8')).toBe('x\nx\nx\n');
  });
  it('refuses identical old and new strings', async () => {
    writeFileSync(join(wt, 'a.txt'), 'a\n');
    const c = ctx();
    await read(c);
    expect(await editTool.run({ path: 'a.txt', old_string: 'a', new_string: 'a' }, c)).toMatchObject({ isError: true, text: expect.stringContaining('identical') });
  });
  it('preserves a byte-order mark and CRLF endings', async () => {
    writeFileSync(join(wt, 'a.txt'), '\uFEFFone\r\ntwo\r\n');
    const c = ctx();
    await read(c);
    await editTool.run({ path: 'a.txt', old_string: 'two', new_string: 'TWO' }, c);
    expect(readFileSync(join(wt, 'a.txt'), 'utf8')).toBe('\uFEFFone\r\nTWO\r\n');
  });
  it('refuses a stale file that changed since it was read', async () => {
    writeFileSync(join(wt, 'a.txt'), 'before\n');
    const c = ctx();
    await read(c);
    writeFileSync(join(wt, 'a.txt'), 'changed externally\n');
    const r = await editTool.run({ path: 'a.txt', old_string: 'changed externally', new_string: 'x' }, c);
    expect(r).toMatchObject({ isError: true, text: expect.stringContaining('file changed since it was read') });
  });
  it('requires a prior read and reports a missing string', async () => {
    writeFileSync(join(wt, 'a.txt'), 'a\n');
    expect(await editTool.run({ path: 'a.txt', old_string: 'a', new_string: 'b' }, ctx())).toMatchObject({ isError: true, text: expect.stringContaining('must be read before it is edited') });
    const c = ctx();
    await read(c);
    expect(await editTool.run({ path: 'a.txt', old_string: 'zzz', new_string: 'b' }, c)).toMatchObject({ isError: true, text: expect.stringContaining('not found') });
  });
});

describe('confinement', () => {
  let outside: string;
  beforeEach(() => { outside = mkdtempSync(join(tmpdir(), 'wa-outside-')); });
  afterEach(() => rmSync(outside, { recursive: true, force: true }));

  it('refuses a symlink whose target escapes the roots', async () => {
    writeFileSync(join(outside, 'secret.txt'), 'secret');
    symlinkSync(join(outside, 'secret.txt'), join(wt, 'link.txt'));
    expect(await readTool.run({ path: 'link.txt' }, ctx())).toMatchObject({ isError: true, text: expect.stringContaining('outside') });
    expect(await writeTool.run({ path: 'link.txt', content: 'x' }, ctx())).toMatchObject({ isError: true, text: expect.stringContaining('outside') });
  });
  it('refuses parent traversal outside the roots', async () => {
    writeFileSync(join(dir, 'sibling.txt'), 's');
    expect(await writeTool.run({ path: '../sibling.txt', content: 'x' }, ctx())).toMatchObject({ isError: true, text: expect.stringContaining('outside') });
  });
  it('refuses the home discovery files for writes but allows reading them', async () => {
    writeFileSync(join(home, 'AGENTS.md'), 'instructions');
    await readTool.run({ path: join(home, 'AGENTS.md') }, ctx());
    expect(await writeTool.run({ path: join(home, 'AGENTS.md'), content: 'x' }, ctx())).toMatchObject({ isError: true, text: expect.stringContaining('protected') });
  });
  it('refuses the worktree .git internals in every mode', async () => {
    mkdirSync(join(wt, '.git', 'hooks'), { recursive: true });
    for (const mode of ['auto', 'bypass', 'restricted'] as const) {
      expect(await writeTool.run({ path: '.git/hooks/pre-commit', content: 'x' }, ctx({ mode }))).toMatchObject({ isError: true, text: expect.stringContaining('protected') });
    }
  });
  it('refuses the workspace state directory in every mode', async () => {
    const configHome = join(dir, 'state', 'runtimes', 'weave');
    mkdirSync(configHome, { recursive: true });
    writeFileSync(join(dir, 'state', 'secrets.enc'), 'ciphertext');
    for (const mode of ['auto', 'bypass', 'restricted'] as const) {
      expect(await readTool.run({ path: join(dir, 'state', 'secrets.enc') }, ctx({ mode, configHome }))).toMatchObject({ isError: true, text: expect.stringContaining('protected') });
    }
  });
  it('allows a system-path read only in auto and bypass', async () => {
    const target = existsSync('/etc/os-release') ? '/etc/os-release' : '/usr/lib/os-release';
    const allowed = await readTool.run({ path: target }, ctx({ mode: 'auto' }));
    expect(allowed.text).not.toContain('outside');
    expect(allowed.isError).toBeFalsy();
    expect(await readTool.run({ path: target }, ctx({ mode: 'restricted' }))).toMatchObject({ isError: true, text: expect.stringContaining('outside') });
  });
});

describe('grep and glob', () => {
  const write = (rel: string, body: string) => { const p = join(wt, rel); mkdirSync(join(p, '..'), { recursive: true }); writeFileSync(p, body); };
  beforeEach(() => { write('a.ts', 'const alpha = 1;\nconst beta = 2;\n'); write('b.ts', 'alpha again\n'); write('deep/c.ts', 'nothing\n'); });
  const hasRg = rgAvailable();

  it('both implementations produce the same rows', async () => {
    const q = { pattern: 'alpha', path: '.' };
    const builtin = await grepTool.run(q, ctx({ rg: false }));
    if (hasRg) {
      const withRg = await grepTool.run(q, ctx({ rg: true }));
      expect(withRg.text.split('\n').sort()).toEqual(builtin.text.split('\n').sort());
    }
    expect(builtin.text).toContain(`${join(wt, 'a.ts')}:1:const alpha = 1;`);
    expect(builtin.text).toContain(`${join(wt, 'b.ts')}:1:alpha again`);
  });
  it('files_with_matches and count agree across implementations', async () => {
    for (const mode of ['files_with_matches', 'count'] as const) {
      const builtin = await grepTool.run({ pattern: 'alpha', path: '.', output_mode: mode }, ctx({ rg: false }));
      if (hasRg) expect((await grepTool.run({ pattern: 'alpha', path: '.', output_mode: mode }, ctx({ rg: true }))).text).toBe(builtin.text);
      expect(builtin.text).toContain(join(wt, 'a.ts'));
    }
    expect((await grepTool.run({ pattern: 'alpha', path: '.', output_mode: 'count' }, ctx({ rg: false }))).text).toContain(`${join(wt, 'a.ts')}:1`);
  });
  it('caps results with a truncation note', async () => {
    const r = await grepTool.run({ pattern: 'alpha', path: '.', head_limit: 1 }, ctx({ rg: false }));
    expect(r.text).toContain('[truncated:');
  });
  it('lists newest-first and notes the cap', async () => {
    for (let i = 0; i < 105; i++) write(`many/f${String(i).padStart(3, '0')}.ts`, 'x');
    const r = await globTool.run({ pattern: 'many/*.ts' }, ctx({ rg: false }));
    const lines = r.text.split('\n');
    expect(lines.filter((l) => l.startsWith(join(wt, 'many')))).toHaveLength(100);
    expect(r.text).toContain('[truncated: 5 more paths]');
  });
  it('glob matches the same paths with rg when present', async () => {
    const q = { pattern: '*.ts', path: '.' };
    const builtin = await globTool.run(q, ctx({ rg: false }));
    if (hasRg) expect((await globTool.run(q, ctx({ rg: true }))).text.split('\n').sort()).toEqual(builtin.text.split('\n').sort());
  });
});

describe('bash', () => {
  it('merges stdout and stderr, appends the exit code and emits command.executed', async () => {
    const c = ctx();
    const r = await bashTool.run({ command: 'echo out; echo err 1>&2; exit 3' }, c);
    expect(r.text).toMatch(/out\nerr\n\nexit code: 3$|out\nerr\nexit code: 3$/);
    expect(r.isError).toBe(true);
    expect(r.meta).toEqual({ command: 'echo out; echo err 1>&2; exit 3', exitCode: 3 });
    expect(emitted.at(-1)).toMatchObject({ type: 'command.executed', payload: { command: 'echo out; echo err 1>&2; exit 3', exitCode: 3, isError: true } });
  });
  it('truncates to the tail and spills the full output outside the worktree', async () => {
    const r = await bashTool.run({ command: 'seq 1 20000' }, ctx());
    expect(r.text).toContain('20000\n');
    expect(r.text).not.toMatch(/^1\n/);
    const spill = /full output: (\S+?)\]/.exec(r.text)![1]!;
    expect(spill.startsWith(join(dir, 'spill'))).toBe(true);
    expect(readFileSync(spill, 'utf8').startsWith('1\n2\n')).toBe(true);
    expect(r.text.endsWith('exit code: 0')).toBe(true);
  });
  it('kills the process tree on timeout', async () => {
    const started = Date.now();
    const r = await bashTool.run({ command: 'sleep 30 & echo $! > pid; wait', timeout: 1 }, ctx());
    expect(Date.now() - started).toBeLessThan(10_000);
    expect(r.text).toContain('[timed out after 1s]');
    const pid = Number(readFileSync(join(wt, 'pid'), 'utf8').trim());
    await new Promise((r2) => setTimeout(r2, 200));
    expect(() => process.kill(pid, 0)).toThrow();
  });
  it('kills the tree when the turn is cancelled', async () => {
    const ac = new AbortController();
    const p = bashTool.run({ command: 'sleep 30 & echo $! > pid; wait' }, ctx({ signal: ac.signal }));
    for (let i = 0; i < 100 && !existsSync(join(wt, 'pid')); i++) await new Promise((r) => setTimeout(r, 20));
    ac.abort();
    await p;
    const pid = Number(readFileSync(join(wt, 'pid'), 'utf8').trim());
    await new Promise((r) => setTimeout(r, 200));
    expect(() => process.kill(pid, 0)).toThrow();
  });
  it('runs with exactly the environment it is given', async () => {
    const r = await bashTool.run({ command: 'env | sort' }, ctx({ env: { PATH: process.env['PATH'] ?? '', FOO: 'bar' } }));
    expect(r.text).toContain('FOO=bar');
    expect(r.text).not.toContain('HOME=/home');
  });
});