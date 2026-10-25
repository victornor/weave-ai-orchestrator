/** `weave daemon update|update apply|update cancel` against a stub daemon. */
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

/** Run the CLI as the shell would, capturing what it printed. */
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

const runningRelease = { version: 'aaaaaaaaaa', path: '/rel/20260101-120000-aaaaaaaaaa', sha: 'a'.repeat(40) };

const upgrade = (over: Record<string, unknown> = {}) => ({
  id: 'u1', state: 'queued', source: '/src/agent-conductor', ref: 'main', runTest: 0, targetSha: 'b'.repeat(40),
  fromRelease: runningRelease.path, toRelease: null, toSha: null, requestedBy: 'op1',
  requestedAt: '2026-09-05T10:00:00.000Z', startedAt: null, finishedAt: null, reason: null, message: null,
  log: [], backups: [], cameBackVersion: null, ...over,
});

describe('weave daemon update', () => {
  it('reports the running release, the target and that an update is available', async () => {
    routes['GET /api/daemon/update'] = () => ({ body: {
      configured: true, running: runningRelease, source: '/src/agent-conductor', ref: 'main',
      targetSha: 'b'.repeat(40), updateAvailable: true, checkedAt: '2026-09-05T10:00:00.000Z', error: null,
    } });
    const out = await cli('daemon', 'update');
    expect(calls).toEqual([{ method: 'GET', path: '/api/daemon/update', body: undefined }]);
    expect(out).toContain('aaaaaaaaaa · 20260101-120000');
    expect(out).not.toContain('v0.1.0');
    expect(out).not.toContain('v1.0.0');
    expect(out).toContain(runningRelease.path);
    expect(out).toContain('update available');
  });

  it('says so when nothing is configured, and offers no upgrade', async () => {
    routes['GET /api/daemon/update'] = () => ({ body: {
      configured: false, running: runningRelease, source: null, ref: null, targetSha: null,
      updateAvailable: false, checkedAt: null, error: null,
    } });
    const out = await cli('daemon', 'update');
    expect(out).toContain('not configured');
    expect(out).not.toContain('update available');
  });

  it('emits the raw status with --json', async () => {
    routes['GET /api/daemon/update'] = () => ({ body: {
      configured: true, running: runningRelease, source: '/src', ref: 'main', targetSha: 'b'.repeat(40),
      updateAvailable: true, checkedAt: null, error: null,
    } });
    const out = await cli('--json', 'daemon', 'update');
    expect(JSON.parse(out)).toMatchObject({ configured: true, updateAvailable: true, running: { version: 'aaaaaaaaaa' } });
  });
});

describe('weave daemon update — a stale release source (VS-830)', () => {
  const staleStatus = {
    configured: true, running: runningRelease, source: 'git@github.com:victornor/old-repo.git', ref: 'main',
    targetSha: 'a'.repeat(40), updateAvailable: false, checkedAt: '2026-10-25T00:00:00.000Z', error: null,
    runtimeSource: 'git@github.com:victornor/old-repo.git',
    staleSource: { configured: 'git@github.com:victornor/old-repo.git', project: { id: 'p1', slug: 'conductor', url: 'git@github.com:victornor/new-repo.git' } },
  };

  it('warns that the source names a repository a project has moved away from', async () => {
    routes['GET /api/daemon/update'] = () => ({ body: staleStatus });
    const out = await cli('daemon', 'update');
    expect(out).toContain('stale release source');
    expect(out).toContain('git@github.com:victornor/new-repo.git');
    expect(out).toContain('weave daemon update source');
  });

  it('keeps the warning alongside a failed check', async () => {
    routes['GET /api/daemon/update'] = () => ({ body: { ...staleStatus, error: 'Could not resolve hostname', targetSha: null } });
    const out = await cli('daemon', 'update');
    expect(out).toContain('stale release source');
    expect(out).toContain('Could not resolve hostname');
  });

  it('says nothing about staleness when the source is fine', async () => {
    routes['GET /api/daemon/update'] = () => ({ body: { ...staleStatus, staleSource: null } });
    const out = await cli('daemon', 'update');
    expect(out).not.toContain('stale release source');
  });
});

describe('weave daemon update source (VS-830)', () => {
  const applied = (over: Record<string, unknown> = {}) => ({
    configured: true, running: runningRelease, source: 'git@github.com:victornor/new-repo.git', ref: 'main',
    targetSha: 'c'.repeat(40), updateAvailable: true, checkedAt: '2026-10-25T00:00:00.000Z', error: null,
    runtimeSource: 'git@github.com:victornor/old-repo.git', staleSource: null, ...over,
  });

  it('PATCHes the new source and reports it as applied', async () => {
    routes['PATCH /api/daemon/update/source'] = (body) => ({ body: applied({ ...(body as object) }) });
    const out = await cli('daemon', 'update', 'source', 'git@github.com:victornor/new-repo.git');
    expect(calls).toEqual([{ method: 'PATCH', path: '/api/daemon/update/source', body: { source: 'git@github.com:victornor/new-repo.git' } }]);
    expect(out).toContain('git@github.com:victornor/new-repo.git');
    expect(out).toContain('main');
  });

  it('sends the ref when one is given', async () => {
    routes['PATCH /api/daemon/update/source'] = (body) => ({ body: applied({ ...(body as object) }) });
    await cli('daemon', 'update', 'source', 'git@github.com:victornor/new-repo.git', '--ref', 'release');
    expect(calls[0]?.body).toEqual({ source: 'git@github.com:victornor/new-repo.git', ref: 'release' });
  });

  it('clears the source with --clear', async () => {
    routes['PATCH /api/daemon/update/source'] = () => ({ body: { configured: false, running: runningRelease, source: null, ref: null, targetSha: null, updateAvailable: false, checkedAt: null, error: null, runtimeSource: null, staleSource: null } });
    const out = await cli('daemon', 'update', 'source', 'ignored', '--clear');
    expect(calls[0]?.body).toEqual({ source: null });
    expect(out).toContain('cleared');
  });

  it('reports the daemon refusing an unreachable source', async () => {
    routes['PATCH /api/daemon/update/source'] = () => ({ status: 400, body: { error: { code: 'validation', message: 'the release source cannot be used: Could not resolve hostname', retryable: false } } });
    await cli('daemon', 'update', 'source', 'git@example.invalid:o/r.git');
    expect(process.exitCode).not.toBe(0);
  });

  it('still warns when the change leaves another stale source', async () => {
    routes['PATCH /api/daemon/update/source'] = () => ({ body: applied({ staleSource: { configured: 'git@github.com:victornor/new-repo.git', project: { id: 'p1', slug: 'conductor', url: 'git@github.com:victornor/third.git' } } }) });
    const out = await cli('daemon', 'update', 'source', 'git@github.com:victornor/new-repo.git');
    expect(out).toContain('stale release source');
  });

  it('emits the raw status with --json', async () => {
    routes['PATCH /api/daemon/update/source'] = (body) => ({ body: applied({ ...(body as object) }) });
    const out = await cli('--json', 'daemon', 'update', 'source', 'git@github.com:victornor/new-repo.git');
    expect(JSON.parse(out)).toMatchObject({ configured: true, source: 'git@github.com:victornor/new-repo.git' });
  });
});

describe('weave daemon update apply', () => {
  it('queues the upgrade with the ref and --test it was given', async () => {
    routes['POST /api/daemon/upgrade'] = (body) => ({ status: 202, body: upgrade({ ...(body as object) }) });
    const out = await cli('daemon', 'update', 'apply', '--ref', 'release', '--test', '--no-follow');
    expect(calls[0]).toMatchObject({ method: 'POST', path: '/api/daemon/upgrade', body: { ref: 'release', test: true } });
    expect(out).toContain('queued');
  });

  it('follows the upgrade to a terminal state and prints the outcome', async () => {
    routes['POST /api/daemon/upgrade'] = () => ({ status: 202, body: upgrade() });
    const states = ['building', 'completed'];
    routes['GET /api/daemon/upgrade'] = () => ({ body: {
      upgrade: upgrade({ state: states.shift() ?? 'completed', cameBackVersion: '1.1.0', toRelease: '/rel/new' }),
      waitingFor: [{ workspace: 'ws1', running: 1, runIds: ['run_1'] }],
    } });
    const out = await cli('daemon', 'update', 'apply');
    expect(out).toContain('building');
    expect(out).toContain('completed');
    expect(out).toContain('1.1.0');
  }, 20_000);

  it('treats an unreachable daemon mid-follow as the restart, not as a failure', async () => {
    routes['POST /api/daemon/upgrade'] = () => ({ status: 202, body: upgrade() });
    let seen = 0;
    routes['GET /api/daemon/upgrade'] = () => {
      seen += 1;
      if (seen === 1) return { status: 503, body: { error: { code: 'internal', message: 'down', retryable: true } } };
      return { body: { upgrade: upgrade({ state: 'completed', cameBackVersion: '1.1.0' }), waitingFor: [] } };
    };
    const out = await cli('daemon', 'update', 'apply');
    expect(out).toContain('unreachable');
    expect(out).toContain('completed');
    expect(process.exitCode ?? 0).toBe(0);
  }, 20_000);

  it('prints the reason when the upgrade fails', async () => {
    routes['POST /api/daemon/upgrade'] = () => ({ status: 202, body: upgrade() });
    routes['GET /api/daemon/upgrade'] = () => ({ body: {
      upgrade: upgrade({ state: 'failed', reason: 'build_failed', message: 'pnpm build exited 1', log: ['error TS1005'] }),
      waitingFor: [],
    } });
    const out = await cli('daemon', 'update', 'apply');
    expect(out).toContain('build_failed');
    expect(out).toContain('pnpm build exited 1');
    expect(out).toContain('error TS1005');
  }, 20_000);
});

describe('weave daemon status', () => {
  it('prints the git sha as version, not v0.1.0', async () => {
    routes['GET /api/health'] = () => ({ body: {
      ok: true, version: 'abc1234def',
      release: { version: 'abc1234def', path: '/rel/20260909-210807-abc1234def', sha: 'abc1234def' },
      tlsMode: 'none', operatorConfigured: true, workspaces: [],
    } });
    const out = await cli('daemon', 'status');
    expect(out).toContain('abc1234def · 20260909-210807');
    expect(out).not.toContain('v0.1.0');
    expect(out).not.toContain('vabc1234def');
  });
});

describe('weave daemon update cancel', () => {
  it('cancels and says dispatch resumed', async () => {
    routes['POST /api/daemon/upgrade/cancel'] = () => ({ body: upgrade({ state: 'cancelled', finishedAt: '2026-09-05T10:01:00.000Z' }) });
    const out = await cli('daemon', 'update', 'cancel');
    expect(calls[0]).toMatchObject({ method: 'POST', path: '/api/daemon/upgrade/cancel' });
    expect(out).toContain('cancelled');
    expect(out).toContain('dispatch resumed');
  });

  it('reports the daemon refusing to cancel a build that already started', async () => {
    routes['POST /api/daemon/upgrade/cancel'] = () => ({ status: 409, body: { error: { code: 'conflict', message: 'upgrade u1 is building and can no longer be cancelled', retryable: false } } });
    await cli('daemon', 'update', 'cancel');
    expect(process.exitCode).not.toBe(0);
  });
});
