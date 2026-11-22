import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { checkIsolation, judgeIsolation, parseMcpList, PROBE_SERVER } from '../src/index.js';
import { writeFakeAgy } from './fakeAgy.js';

const fixture = (n: string) => readFileSync(new URL(`../fixtures/${n}`, import.meta.url), 'utf8');
const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

describe('agy --gemini_dir isolation check (VS-995)', () => {
  it('parses agy 1.5.14 `mcp list` output (captured)', () => {
    expect(parseMcpList(fixture('mcp-list-one.txt'))).toEqual(['captains-personal']);
    expect(parseMcpList(fixture('mcp-list-empty.txt'))).toEqual([]);
  });

  it('passes only when exactly the seeded server is listed', () => {
    expect(judgeIsolation({ exitCode: 0, stdout: `NAME TYPE STATUS COMMAND/URL\n${PROBE_SERVER}  stdio  enabled  true\n`, stderr: '' })).toEqual({ ok: true });
    const leaked = judgeIsolation({ exitCode: 0, stdout: fixture('mcp-list-one.txt'), stderr: '' });
    expect(leaked.ok).toBe(false);
  });

  it('accepts an agy that honours the flag', async () => {
    const d = writeFakeAgy('ok'); dirs.push(d);
    expect(await checkIsolation(join(d, 'agy'), { ...process.env as Record<string, string> })).toEqual({ ok: true });
  });

  it('refuses an agy that ignores the flag', async () => {
    const d = writeFakeAgy('ignore-dir'); dirs.push(d);
    const r = await checkIsolation(join(d, 'agy'), { ...process.env as Record<string, string>, HOME: d });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/isolation check failed/);
  });

  it('refuses an agy that rejects the flag', async () => {
    const d = writeFakeAgy('reject-dir'); dirs.push(d);
    const r = await checkIsolation(join(d, 'agy'), { ...process.env as Record<string, string> });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/exited 2.*gemini_dir/);
  });
});

/**
 * Opt-in: the real binary. `AGY_BIN=/path/to/agy pnpm vitest run packages/runtimes/agy` runs the
 * self-check against it under a scratch HOME with no session bus. `mcp list` reads local config
 * only — no login, no network — so it never touches the owner's agy credential. Skipped by default.
 */
describe.skipIf(!process.env['AGY_BIN'])('agy --gemini_dir isolation against the real binary (opt-in)', () => {
  it('lists only the seeded server', async () => {
    const home = mkdtempSync(join(tmpdir(), 'ac-agy-real-home-')); dirs.push(home);
    const env = { PATH: process.env['PATH'] ?? '/usr/bin', HOME: home, XDG_CONFIG_HOME: join(home, '.config'), XDG_RUNTIME_DIR: home, DBUS_SESSION_BUS_ADDRESS: '' };
    expect(await checkIsolation(process.env['AGY_BIN']!, env)).toEqual({ ok: true });
  });
});
