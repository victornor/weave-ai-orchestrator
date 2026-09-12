/** `weave project add|retry` against a stub daemon that streams a job (VS-37). */
import { createServer, type Server } from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildProgram } from './program.js';
import { configureOutput } from './output.js';

interface Call { method: string; path: string; body: unknown }

let server: Server | null = null;
let url = '';
let calls: Call[] = [];
let routes: Record<string, (body: unknown) => { status?: number; body: unknown }> = {};
/** SSE frames the job stream serves, in order, then the stream ends. */
let frames: string[] = [];

const step = (id: string, label: string, state: string, ms = 0): string =>
  `event: job.step\ndata: ${JSON.stringify({ kind: 'step', jobId: 'j1', seq: 0, step: { id, label, state, startedAt: '2026-09-05T10:00:00.000Z', endedAt: state === 'running' ? null : new Date(Date.parse('2026-09-05T10:00:00.000Z') + ms).toISOString() } })}\nid: 0\n\n`;
const line = (seq: number, stepId: string, text: string): string =>
  `event: job.log\ndata: ${JSON.stringify({ kind: 'log', jobId: 'j1', seq, line: { seq, step: stepId, stream: 'stderr', text } })}\nid: ${seq}\n\n`;
const finished = (over: Record<string, unknown> = {}): string => {
  const job = {
    id: 'j1', workspaceId: 'ws1', kind: 'project_add', entityType: 'project', entityId: 'p1', state: 'done',
    steps: [{ id: 'clone', label: 'Clone the repository', state: 'done', startedAt: '2026-09-05T10:00:00.000Z', endedAt: '2026-09-05T10:00:12.000Z' },
      { id: 'openspec', label: 'Adopt OpenSpec', state: 'skipped', startedAt: '2026-09-05T10:00:12.000Z', endedAt: '2026-09-05T10:00:12.000Z' }],
    log: [{ seq: 1, step: 'clone', stream: 'stderr', text: 'fatal: repository not found' }],
    logSeq: 1, requestedBy: 'human:op1', startedAt: '2026-09-05T10:00:00.000Z', finishedAt: '2026-09-05T10:00:20.000Z',
    failedStep: null, message: null, ...over,
  };
  return `event: job.finished\ndata: ${JSON.stringify({ kind: 'finished', jobId: 'j1', seq: 1, job })}\nid: 1\n\n`;
};

beforeEach(async () => {
  calls = [];
  routes = {};
  frames = [];
  server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c: Buffer) => { raw += c.toString('utf8'); });
    req.on('end', () => {
      const path = (req.url ?? '').split('?')[0]!;
      const body = raw ? JSON.parse(raw) as unknown : undefined;
      calls.push({ method: req.method ?? '', path, body });
      if (path.endsWith('/stream')) {
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
        for (const frame of frames) res.write(frame);
        res.end();
        return;
      }
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

/** Run the CLI as the shell would, capturing stdout and stderr separately. */
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

const project = (over: Record<string, unknown> = {}) => ({ id: 'p1', slug: 'api', status: 'cloning', defaultBranch: 'main', clonePath: '/ws/projects/api', ...over });

describe('weave project add', () => {
  it('prints each sub-step and the output of the one running', async () => {
    routes['POST /api/w/ws1/projects'] = () => ({ status: 202, body: { project: project(), jobId: 'j1' } });
    routes['GET /api/w/ws1/projects/api'] = () => ({ body: project({ status: 'ready' }) });
    frames = [
      step('clone', 'Clone the repository', 'running'),
      line(1, 'clone', 'Cloning into /ws/projects/api…'),
      line(2, 'clone', 'Receiving objects: 100%'),
      step('clone', 'Clone the repository', 'done', 12_000),
      step('openspec', 'Adopt OpenSpec', 'skipped'),
      finished(),
    ];

    const { out, err } = await cli('project', 'add', 'git@github.com:acme/api.git', '--id', 'api');
    expect(err).toContain('Clone the repository…');
    expect(err).toContain('Cloning into /ws/projects/api…');
    expect(err).toContain('Receiving objects: 100%');
    expect(err).toContain('✓ Clone the repository (12s)');
    expect(err).toContain('Adopt OpenSpec skipped');
    expect(out).toContain('project added api');
    expect(out).toContain('ready');
    expect(process.exitCode).toBeUndefined();
  });

  it('sends --landing-branch as landingBranch on the request body (VS-119)', async () => {
    routes['POST /api/w/ws1/projects'] = () => ({ status: 202, body: { project: project(), jobId: 'j1' } });
    routes['GET /api/w/ws1/projects/api'] = () => ({ body: project({ status: 'ready' }) });
    frames = [finished()];

    await cli('project', 'add', 'git@github.com:acme/fernwood.git', '--id', 'api', '--branch', 'main', '--landing-branch', 'edge');
    const posted = calls.find((c) => c.method === 'POST' && c.path === '/api/w/ws1/projects');
    expect(posted?.body).toMatchObject({ defaultBranch: 'main', landingBranch: 'edge' });
  });

  it('names the failing sub-step, shows its last lines and exits non-zero', async () => {
    routes['POST /api/w/ws1/projects'] = () => ({ status: 202, body: { project: project(), jobId: 'j1' } });
    routes['GET /api/w/ws1/projects/api'] = () => ({ body: project({ status: 'error' }) });
    frames = [
      step('clone', 'Clone the repository', 'running'),
      line(1, 'clone', 'fatal: repository not found'),
      step('clone', 'Clone the repository', 'failed'),
      finished({ state: 'failed', failedStep: 'clone', message: 'git clone failed: fatal: repository not found' }),
    ];

    const { err } = await cli('project', 'add', 'git@github.com:acme/nope.git', '--id', 'api');
    expect(err).toContain('failed Clone the repository');
    expect(err).toContain('fatal: repository not found');
    expect(err).toContain('weave project retry api');
    expect(process.exitCode).toBeGreaterThan(0);
  });

  it('prints exactly one JSON document with no progress interleaved', async () => {
    configureOutput({ json: true });
    routes['POST /api/w/ws1/projects'] = () => ({ status: 202, body: { project: project(), jobId: 'j1' } });
    routes['GET /api/w/ws1/projects/api'] = () => ({ body: project({ status: 'ready' }) });
    frames = [step('clone', 'Clone the repository', 'running'), line(1, 'clone', 'noise'), finished()];

    const { out, err } = await cli('--json', 'project', 'add', 'git@github.com:acme/api.git', '--id', 'api');
    expect(err).toBe('');
    expect(JSON.parse(out)).toMatchObject({ slug: 'api', status: 'ready' });
  });

  it('--no-follow returns the job without watching it', async () => {
    routes['POST /api/w/ws1/projects'] = () => ({ status: 202, body: { project: project(), jobId: 'j1' } });
    const { out } = await cli('project', 'add', 'git@github.com:acme/api.git', '--id', 'api', '--no-follow');
    expect(out).toContain('project add started api');
    expect(calls.some((c) => c.path.endsWith('/stream'))).toBe(false);
  });
});

describe('weave project set-landing-branch (VS-122)', () => {
  it('sets the landing branch and reports what is in effect', async () => {
    routes['PATCH /api/w/ws1/projects/api'] = () => ({ body: project({ status: 'ready', landingBranch: 'edge' }) });

    const { out } = await cli('project', 'set-landing-branch', 'api', 'edge');
    const patched = calls.find((c) => c.method === 'PATCH' && c.path === '/api/w/ws1/projects/api');
    expect(patched?.body).toEqual({ landingBranch: 'edge' });
    expect(out).toContain('updated api: landing branch = edge');
  });

  it('--clear sends an empty string and reports the default branch is in effect', async () => {
    routes['PATCH /api/w/ws1/projects/api'] = () => ({ body: project({ status: 'ready', landingBranch: null }) });

    const { out } = await cli('project', 'set-landing-branch', 'api', '--clear');
    const patched = calls.find((c) => c.method === 'PATCH' && c.path === '/api/w/ws1/projects/api');
    expect(patched?.body).toEqual({ landingBranch: '' });
    expect(out).toContain('updated api: landing branch = using default branch `main`');
  });

  it('rejects passing both a branch and --clear, without sending a request', async () => {
    const { err } = await cli('project', 'set-landing-branch', 'api', 'edge', '--clear');
    expect(err).toContain('pass a branch or --clear, not both');
    expect(calls.some((c) => c.method === 'PATCH')).toBe(false);
    expect(process.exitCode).toBeGreaterThan(0);
  });

  it('rejects passing neither a branch nor --clear, without sending a request', async () => {
    const { err } = await cli('project', 'set-landing-branch', 'api');
    expect(err).toContain('pass a branch to set, or --clear to clear the landing branch');
    expect(calls.some((c) => c.method === 'PATCH')).toBe(false);
    expect(process.exitCode).toBeGreaterThan(0);
  });

  it('prints the daemon rejection when the branch does not exist on the remote', async () => {
    routes['PATCH /api/w/ws1/projects/api'] = () => ({
      status: 400,
      body: { error: { code: 'validation', message: "branch 'nope' was not found on origin as of api's last fetch", retryable: false } },
    });

    const { err } = await cli('project', 'set-landing-branch', 'api', 'nope');
    expect(err).toContain("branch 'nope' was not found on origin");
    expect(process.exitCode).toBeGreaterThan(0);
  });
});

describe('weave project retry', () => {
  it('posts the retry and follows the new job', async () => {
    routes['POST /api/w/ws1/projects/api/retry'] = () => ({ status: 202, body: { project: project(), jobId: 'j1' } });
    routes['GET /api/w/ws1/projects/api'] = () => ({ body: project({ status: 'ready' }) });
    frames = [step('clone', 'Clone the repository', 'done', 200), finished()];

    const { out } = await cli('project', 'retry', 'api');
    expect(calls.some((c) => c.method === 'POST' && c.path === '/api/w/ws1/projects/api/retry')).toBe(true);
    expect(out).toContain('project added api');
  });
});
