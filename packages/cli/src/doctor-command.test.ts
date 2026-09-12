/**
 * `weave doctor`'s runtime credential check (VS-75,
 * runtime-credentials/credential-visibility), against a stub daemon.
 *
 * The check exists so a human who has just been told "every agent is stopped" can confirm it from
 * the command line and be told exactly what to run — without the token ever appearing.
 */
import { createServer, type Server } from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildProgram } from './program.js';
import { configureOutput } from './output.js';

let server: Server | null = null;
let url = '';
let routes: Record<string, unknown> = {};

beforeEach(async () => {
  routes = {};
  server = createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      const path = (req.url ?? '').split('?')[0]!;
      const body = routes[path];
      res.writeHead(body === undefined ? 404 : 200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body ?? { error: { code: 'not_found', message: `no stub for ${path}`, retryable: false } }));
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
    await buildProgram().parseAsync(['node', 'conductor', '--url', url, '-w', 'ws1', ...argv], { from: 'node' });
  } finally {
    spy.mockRestore();
    configureOutput({ json: false });
  }
  return out;
}

const TOKEN = 'sk-ant-oat01-MUST-NOT-APPEAR';

const valid = {
  runtimeId: 'claude', present: true, expiresAt: '2026-09-08T10:00:00.000Z',
  lastVerifiedAt: '2026-09-07T09:00:00.000Z', refreshFailedAt: null, needsLogin: false,
};
const expired = { ...valid, needsLogin: true, refreshFailedAt: '2026-09-07T09:07:00.000Z' };

function stub(credentials: unknown[]): void {
  routes['/api/health'] = { version: '1.0.0', tlsMode: 'none', operatorConfigured: true, workspaces: [{ id: 'ws1' }], host: { hostname: 'elsewhere' } };
  routes['/api/runtimes'] = { runtimes: [] };
  routes['/api/w/ws1/usage/credentials'] = credentials;
}

describe('weave doctor — runtime credentials', () => {
  it('passes and names the expiry when the credential is valid', async () => {
    stub([valid]);
    const out = await cli('doctor');
    expect(out).toContain('credential claude');
    expect(out).toContain('valid');
    expect(out).toContain('2026-09-08 10:00 UTC');
  });

  it('fails and names the login command when a login is needed', async () => {
    stub([expired]);
    const out = await cli('doctor');
    expect(out).toContain('credential claude');
    expect(out).toContain('login expired');
    expect(out).toContain('2026-09-07 09:07 UTC');
    expect(out).toContain('claude /login');
    expect(out).toContain('resumes on its own');
  });

  it('reports a runtime with no credential at all without failing the run', async () => {
    stub([{ ...valid, present: false, expiresAt: null, lastVerifiedAt: null }]);
    const out = await cli('doctor');
    expect(out).toContain('no credential on the daemon host');
  });

  it('adds no credential checks when the daemon does not serve the route', async () => {
    routes['/api/health'] = { version: '1.0.0', tlsMode: 'none', operatorConfigured: true, workspaces: [{ id: 'ws1' }], host: { hostname: 'elsewhere' } };
    routes['/api/runtimes'] = { runtimes: [] };
    const out = await cli('doctor');
    expect(out).not.toContain('credential ');
    expect(out).toContain('daemon api');
  });

  it('never prints a token, even when the daemon wrongly returns one', async () => {
    stub([{ ...expired, accessToken: TOKEN, detail: `refresh failed for ${TOKEN}` }]);
    const out = await cli('doctor');
    expect(out).not.toContain(TOKEN);
    expect(out).not.toContain('sk-ant');
  });
});
