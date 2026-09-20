import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { bashTool } from './bash.js';
import { readTool } from './read.js';
import type { ToolCtx } from './index.js';

let dir: string;
const ctx = (over: Partial<ToolCtx> = {}): ToolCtx => ({ cwd: dir, env: { PATH: process.env['PATH'] ?? '', HOME: dir }, signal: new AbortController().signal, callId: 'c1', spillDir: join(dir, '.spill'), ...over });
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'wa-tools-')); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('read', () => {
  it('numbers lines and pages a large file with a footer naming the next offset', async () => {
    writeFileSync(join(dir, 'big.txt'), Array.from({ length: 5000 }, (_, i) => `line ${i + 1}`).join('\n') + '\n');
    const r = await readTool.run({ path: 'big.txt' }, ctx());
    const rows = r.text.split('\n');
    expect(rows[0]).toBe('1\tline 1');
    expect(rows[1999]).toBe('2000\tline 2000');
    expect(r.text.endsWith('[showing lines 1-2000 of 5000; call read with offset=2001]')).toBe(true);
    const next = await readTool.run({ path: 'big.txt', offset: 4999, limit: 10 }, ctx());
    expect(next.text).toBe('4999\tline 4999\n5000\tline 5000');
  });
  it('stops at 50 KB and truncates a very long line', async () => {
    writeFileSync(join(dir, 'wide.txt'), Array.from({ length: 200 }, () => 'x'.repeat(1000)).join('\n'));
    const r = await readTool.run({ path: 'wide.txt' }, ctx());
    expect(r.text.length).toBeLessThan(52 * 1024);
    expect(r.text).toMatch(/\[showing lines 1-\d+ of 200; call read with offset=\d+\]$/);
    writeFileSync(join(dir, 'long.txt'), 'y'.repeat(5000));
    expect((await readTool.run({ path: 'long.txt' }, ctx())).text).toContain('… [line truncated, 5000 chars]');
  });
  it('lists a directory sorted with a slash suffix, and refuses a binary file', async () => {
    mkdirSync(join(dir, 'sub'));
    writeFileSync(join(dir, 'b.txt'), 'b');
    writeFileSync(join(dir, 'a.bin'), Buffer.from([1, 0, 2]));
    expect((await readTool.run({ path: '.' }, ctx())).text).toBe('a.bin\nb.txt\nsub/');
    expect(await readTool.run({ path: 'a.bin' }, ctx())).toMatchObject({ text: 'Error: binary file', isError: true });
  });
  it('reports a missing path as an ordinary error result', async () => {
    expect(await readTool.run({ path: 'nope' }, ctx())).toMatchObject({ isError: true, text: expect.stringMatching(/^Error: no such file/) });
  });
});

describe('bash', () => {
  it('merges stdout and stderr and appends the exit code', async () => {
    const r = await bashTool.run({ command: 'echo out; echo err 1>&2; exit 3' }, ctx());
    expect(r.text).toMatch(/out\nerr\n\nexit code: 3$|out\nerr\nexit code: 3$/);
    expect(r.isError).toBe(true);
    expect(r.meta).toEqual({ command: 'echo out; echo err 1>&2; exit 3', exitCode: 3 });
  });
  it('truncates to the tail and spills the full output outside the worktree', async () => {
    const r = await bashTool.run({ command: 'seq 1 20000' }, ctx());
    expect(r.text).toContain('20000\n');
    expect(r.text).not.toMatch(/^1\n/);
    const spill = /full output: (\S+?)\]/.exec(r.text)![1]!;
    expect(spill.startsWith(join(dir, '.spill'))).toBe(true);
    expect(readFileSync(spill, 'utf8').startsWith('1\n2\n')).toBe(true);
    expect(r.text.endsWith('exit code: 0')).toBe(true);
  });
  it('kills the process tree on timeout', async () => {
    const started = Date.now();
    const r = await bashTool.run({ command: 'sleep 30 & echo $! > pid; wait', timeout: 1 }, ctx());
    expect(Date.now() - started).toBeLessThan(10_000);
    expect(r.text).toContain('[timed out after 1s]');
    const pid = Number(readFileSync(join(dir, 'pid'), 'utf8').trim());
    await new Promise((r2) => setTimeout(r2, 200));
    expect(() => process.kill(pid, 0)).toThrow();
  });
  it('kills the tree when the turn is cancelled', async () => {
    const ac = new AbortController();
    const p = bashTool.run({ command: 'sleep 30 & echo $! > pid; wait' }, ctx({ signal: ac.signal }));
    for (let i = 0; i < 100 && !existsSync(join(dir, 'pid')); i++) await new Promise((r) => setTimeout(r, 20));
    ac.abort();
    await p;
    const pid = Number(readFileSync(join(dir, 'pid'), 'utf8').trim());
    await new Promise((r) => setTimeout(r, 200));
    expect(() => process.kill(pid, 0)).toThrow();
  });
  it('runs with exactly the environment it is given', async () => {
    const r = await bashTool.run({ command: 'env | sort' }, ctx({ env: { PATH: process.env['PATH'] ?? '', FOO: 'bar' } }));
    expect(r.text).toContain('FOO=bar');
    expect(r.text).not.toContain('HOME=/home');
  });
});
