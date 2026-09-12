/**
 * VS-262: `weave daemon stop` requests the same bounded drain over HTTP `daemon
 * restart`/`upgrade`/`rollback` already do, before signalling the process.
 */
import { createServer, type Server } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildProgram } from '../program.js';
import { configureOutput } from '../output.js';

interface Call { method: string; path: string; body: unknown }

let server: Server | null = null;
let url = '';
let calls: Call[] = [];
let routes: Record<string, (body: unknown) => { status?: number; body: unknown }> = {};
let stateDir: string;
const savedStateHome = process.env['XDG_STATE_HOME'];

beforeEach(async () => {
  calls = [];
  routes = {};
  // No pid file here, so `stopDaemon()` returns `{ stopped: false }` immediately without touching
  // any real process — this test is only about the drain step happening before it.
  stateDir = mkdtempSync(join(tmpdir(), 'ac-stop-cmd-'));
  process.env['XDG_STATE_HOME'] = stateDir;
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
  rmSync(stateDir, { recursive: true, force: true });
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
});
