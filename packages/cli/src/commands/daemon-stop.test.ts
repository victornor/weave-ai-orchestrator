/**
 * VS-262: `weave daemon stop` requests the same bounded drain over HTTP `daemon
 * restart`/`upgrade`/`rollback` already do, before signalling the process.
 *
 * VS-388: it also isolates `XDG_CONFIG_HOME`, not only `XDG_STATE_HOME` — `stopDaemonService()`
 * follows the installed unit, which `resolveInstalledUnit()` reads from `$XDG_CONFIG_HOME`. Without
 * this, the test found the host's live `weave-ai.service` and ran a real `systemctl --user stop` on
 * it. The fake unit below lives in the scratch config dir; the systemd-path case injects a recording
 * runner so nothing is ever spawned.
 */
import { createServer, type Server } from 'node:http';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SERVICE_NAME } from '@weave-ai/release';

// VS-388: the CLI action calls `stopDaemonService()` with no runner, so this wrapper supplies a
// recording one. The real function still resolves the unit from the scratch `XDG_CONFIG_HOME`.
const recorded = vi.hoisted(() => ({ runs: [] as string[][] }));
vi.mock('../daemon.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../daemon.js')>();
  const run = (cmd: string, args: string[]) => {
    recorded.runs.push([cmd, ...args]);
    return { status: 0, signal: null, stdout: '', stderr: '' };
  };
  return {
    ...actual,
    stopDaemonService: (r = run, platform = process.platform) => actual.stopDaemonService(r, platform),
  };
});

import { buildProgram } from '../program.js';
import { configureOutput } from '../output.js';

interface Call { method: string; path: string; body: unknown }

let server: Server | null = null;
let url = '';
let calls: Call[] = [];
let routes: Record<string, (body: unknown) => { status?: number; body: unknown }> = {};
let stateDir: string;
let configDir: string;
const savedStateHome = process.env['XDG_STATE_HOME'];
const savedConfigHome = process.env['XDG_CONFIG_HOME'];

beforeEach(async () => {
  calls = [];
  routes = {};
  recorded.runs = [];
  // No pid file here, so `stopDaemon()` returns `{ stopped: false }` immediately without touching
  // any real process — this test is only about the drain step happening before it.
  stateDir = mkdtempSync(join(tmpdir(), 'ac-stop-cmd-'));
  process.env['XDG_STATE_HOME'] = stateDir;
  // VS-388: scratch config home, so no host unit is ever resolved.
  configDir = mkdtempSync(join(tmpdir(), 'ac-stop-cmd-config-'));
  process.env['XDG_CONFIG_HOME'] = configDir;
  server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c: Buffer) => { raw += c.toString('utf8'); });
    req.on('end', () => {
      const path = (req.url ?? '').split('?')[0]!;
      const body = raw ? JSON.parse(raw) : undefined;
      calls.push({ method: req.method ?? '', path, body });
      const handler = routes[`${req.method} ${path}`];
      const result = handler ? handler(body) : { status: 404, body: { error: { code: 'not_found', message: `no stub for ${req.method} ${path}`, retryable: false } } };
      res.writeHead(result.status ?? 200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(result.body));
    });
  });
  await new Promise<void>((r) => server!.listen(0, '127.0.0.1', () => r()));
  const addr = server.address();
  url = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
});

afterEach(async () => {
  await new Promise<void>((r) => server?.close(() => r()));
  server = null;
  process.exitCode = undefined;
  if (savedStateHome === undefined) delete process.env['XDG_STATE_HOME'];
  else process.env['XDG_STATE_HOME'] = savedStateHome;
  if (savedConfigHome === undefined) delete process.env['XDG_CONFIG_HOME'];
  else process.env['XDG_CONFIG_HOME'] = savedConfigHome;
  rmSync(stateDir, { recursive: true, force: true });
  rmSync(configDir, { recursive: true, force: true });
});

async function cli(...argv: string[]): Promise<string> {
  let out = '';
  const spy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => { out += String(chunk); return true; });
  try {
    await buildProgram().parseAsync(['node', 'conductor', '--url', url, ...argv], { from: 'node' });
  } finally {
    spy.mockRestore();
    configureOutput({ json: false });
  }
  return out;
}

describe('weave daemon stop', () => {
  it('drains before stopping, with the default 180s budget', async () => {
    routes['POST /api/daemon/drain'] = () => ({ body: { drained: true, running: [], workspaces: ['ws1'] } });
    const out = await cli('daemon', 'stop');
    expect(calls[0]).toMatchObject({ method: 'POST', path: '/api/daemon/drain', body: { timeoutSec: 180 } });
    expect(out).toContain('not running');
  });

  it('passes a custom --drain-timeout through to the drain request', async () => {
    routes['POST /api/daemon/drain'] = () => ({ body: { drained: true, running: [], workspaces: ['ws1'] } });
    await cli('daemon', 'stop', '--drain-timeout', '45');
    expect(calls[0]).toMatchObject({ method: 'POST', path: '/api/daemon/drain', body: { timeoutSec: 45 } });
  });

  it('reports interrupted runs from a drain that hit its budget', async () => {
    routes['POST /api/daemon/drain'] = () => ({ body: { drained: false, running: [{ workspace: 'ws1', runId: 'run_1' }], workspaces: ['ws1'] } });
    const out = await cli('daemon', 'stop');
    expect(out).toContain('1 run(s)');
    expect(out).toContain('interrupted');
  });

  it('proceeds to stop even when the drain request itself fails', async () => {
    // No route stubbed for /api/daemon/drain: the stub server 404s it.
    const out = await cli('daemon', 'stop');
    expect(calls).toHaveLength(1);
    expect(calls[0]!.path).toBe('/api/daemon/drain');
    expect(out).toContain('not running');
  });

  it('follows the installed unit from the scratch config dir, spawning nothing for real', async () => {
    // VS-388: a fake unit is present in this test's temp XDG_CONFIG_HOME. The CLI must resolve it and
    // take the systemd path — through the injected runner, so no `systemctl` process is ever created.
    const dir = join(configDir, 'systemd', 'user');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, SERVICE_NAME), '[Service]\nRestart=always\n');
    routes['POST /api/daemon/drain'] = () => ({ body: { drained: true, running: [], workspaces: ['ws1'] } });
    const out = await cli('daemon', 'stop');
    expect(out).toContain('stopped');
    expect(out).toContain(`systemctl --user stop ${SERVICE_NAME}`);
    expect(recorded.runs).toEqual([['systemctl', '--user', 'stop', SERVICE_NAME]]);
  });
});
