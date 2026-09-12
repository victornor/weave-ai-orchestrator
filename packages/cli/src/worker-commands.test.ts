/** `weave worker handover|handback` (VS-249). */
import { createServer, type Server } from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildProgram } from './program.js';
import { configureOutput } from './output.js';

interface Call { method: string; path: string; body: unknown }

let server: Server | null = null;
let url = '';
let calls: Call[] = [];
let routes: Record<string, (body: unknown) => { status?: number; body: unknown }> = {};

beforeEach(async () => {
  calls = [];
  routes = {};
  server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c: Buffer) => { raw += c.toString('utf8'); });
    req.on('end', () => {
      const path = (req.url ?? '').split('?')[0]!;
      const body = raw ? JSON.parse(raw) as unknown : undefined;
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
});

async function cli(...argv: string[]): Promise<{ out: string; err: string }> {
  let out = '';
  let err = '';
  const o = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => { out += String(chunk); return true; });
  const e = vi.spyOn(process.stderr, 'write').mockImplementation((chunk: string | Uint8Array) => { err += String(chunk); return true; });
  try {
    await buildProgram().parseAsync(['node', 'conductor', '--url', url, '--no-color', '-w', 'ws1', ...argv], { from: 'node' });
  } finally {
    o.mockRestore();
    e.mockRestore();
    configureOutput({ json: false });
  }
  return { out, err };
}

describe('weave worker handover', () => {
  it('prints the landing line and the command on separate lines', async () => {
    routes['POST /api/w/ws1/workers/ag_1/handover'] = () => ({
      body: { resumable: true, command: "cd '/home/a1' && CLAUDE_CONFIG_DIR='/ws/runtimes/claude' claude --resume sess-1", runtime: 'claude', landingLine: 'Lands in the home directory.', reason: null },
    });

    const { out } = await cli('worker', 'handover', 'ag_1');
    expect(out).toContain('Lands in the home directory.');
    expect(out).toContain("claude --resume sess-1");
    const posted = calls.find((c) => c.method === 'POST' && c.path === '/api/w/ws1/workers/ag_1/handover');
    expect(posted).toBeTruthy();
  });

  it('prints the reason plainly for an unresumable worker, no command', async () => {
    routes['POST /api/w/ws1/workers/ag_1/handover'] = () => ({
      body: { resumable: false, command: null, runtime: 'gemini', landingLine: null, reason: 'gemini cannot resume a session outside the daemon.' },
    });

    const { out } = await cli('worker', 'handover', 'ag_1');
    expect(out).toContain('gemini cannot resume a session outside the daemon.');
  });

  it('exits non-zero and reports the code when the worker is already held', async () => {
    routes['POST /api/w/ws1/workers/ag_1/handover'] = () => ({
      status: 409, body: { error: { code: 'wrong_status', message: "Backend Engineer #1's session is already held", retryable: false } },
    });

    await cli('worker', 'handover', 'ag_1');
    expect(process.exitCode).not.toBe(0);
  });
});

describe('weave worker handback', () => {
  it('sends the note and confirms the handback', async () => {
    routes['POST /api/w/ws1/workers/ag_1/handback'] = () => ({
      body: { note: 'attached Frida to the device', reconciliation: { worktree: { headBefore: 'a', headAfter: 'b', newCommits: 1, dirty: false, changedFiles: 0 }, sessionActivityDetected: true, durationMs: 60_000 } },
    });

    const { out } = await cli('worker', 'handback', 'ag_1', '--note', 'attached Frida to the device');
    expect(out).toContain('given back');
    const posted = calls.find((c) => c.method === 'POST' && c.path === '/api/w/ws1/workers/ag_1/handback');
    expect(posted?.body).toMatchObject({ note: 'attached Frida to the device' });
  });
});
