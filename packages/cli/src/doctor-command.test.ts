/**
 * `weave doctor`'s runtime credential check (VS-75,
 * runtime-credentials/credential-visibility), against a stub daemon.
 *
 * The check exists so a human who has just been told "every agent is stopped" can confirm it from
 * the command line and be told exactly what to run — without the token ever appearing.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
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

/**
 * VS-377: `doctor` reports the `weave` shim. Everything runs in a temp HOME / XDG pair; the real
 * `~/.local/bin`, release dirs and config are never read or written.
 */
describe('weave doctor — the CLI shim (VS-377)', () => {
  const saved = { HOME: process.env['HOME'], XDG_CONFIG_HOME: process.env['XDG_CONFIG_HOME'], XDG_DATA_HOME: process.env['XDG_DATA_HOME'] };
  let home: string;
  let configDir: string;
  let dataDir: string;

  const releaseBin = (): string => join(dataDir, 'weave', 'current', 'packages', 'cli', 'dist', 'bin.js');
  const shimPath = (): string => join(home, '.local', 'bin', 'weave');

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'vs377-doc-home-'));
    configDir = mkdtempSync(join(tmpdir(), 'vs377-doc-config-'));
    dataDir = mkdtempSync(join(tmpdir(), 'vs377-doc-data-'));
    process.env['HOME'] = home;
    process.env['XDG_CONFIG_HOME'] = configDir;
    process.env['XDG_DATA_HOME'] = dataDir;
    mkdirSync(dirname(releaseBin()), { recursive: true });
    writeFileSync(releaseBin(), '// cli\n');
    stub([valid]);
  });

  afterEach(() => {
    for (const k of ['HOME', 'XDG_CONFIG_HOME', 'XDG_DATA_HOME'] as const) {
      if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
    }
    for (const dir of [home, configDir, dataDir]) rmSync(dir, { recursive: true, force: true });
  });

  it('fails a missing shim and names the command that writes it', async () => {
    const out = await cli('doctor');
    expect(out).toContain('weave CLI shim');
    expect(out).toContain('missing at');
    expect(out).toContain('weave daemon install-service');
  });

  it('fails a shim that points at a non-current release', async () => {
    mkdirSync(dirname(shimPath()), { recursive: true });
    writeFileSync(shimPath(), `#!/bin/sh\nexec "/usr/bin/node" "${join(dataDir, 'weave', 'releases', 'old', 'packages', 'cli', 'dist', 'bin.js')}" "$@"\n`);
    const out = await cli('doctor');
    expect(out).toContain('weave CLI shim');
    expect(out).toContain('not the current release');
  });

  it('passes a shim that names the current release', async () => {
    mkdirSync(dirname(shimPath()), { recursive: true });
    writeFileSync(shimPath(), `#!/bin/sh\nexec "/usr/bin/node" "${releaseBin()}" "$@"\n`);
    const out = await cli('doctor');
    expect(out).toMatch(/ok\s+weave CLI shim/);
    expect(out).not.toContain('missing at');
  });
});
