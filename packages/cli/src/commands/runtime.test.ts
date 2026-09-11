/** `conductor runtime login` against a stub daemon (VS-258: the configHome fix). */
import { createServer, type Server } from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildProgram } from '../program.js';
import { configureOutput } from '../output.js';

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

describe('conductor runtime login (VS-258)', () => {
  it('builds the config home under the workspace\'s resolved new name, not a hardcoded literal', async () => {
    routes['GET /api/runtimes'] = () => ({ body: { runtimes: [{ id: 'claude', displayName: 'Claude Code' }] } });
    routes['GET /api/w/acme'] = () => ({ body: { rootPath: '/does/not/exist/on/disk' } });

    const out = await cli('-w', 'acme', 'runtime', 'login', 'claude', '--print', '--json');
    const plan = JSON.parse(out) as { configHome: string };
    // '/does/not/exist/on/disk' has nothing under either name: a fresh resolution, new name.
    expect(plan.configHome).toBe('/does/not/exist/on/disk/.weave/runtimes/claude');
  });
});
