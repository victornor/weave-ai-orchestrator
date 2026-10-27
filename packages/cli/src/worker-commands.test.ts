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

describe('weave worker prune-homes (VS-859)', () => {
  const result = (dryRun: boolean, ignoreAge = false, candidates = 1) => ({
    dryRun,
    ignoreAge,
    windowDays: 30,
    candidates: Array.from({ length: candidates }, (_, i) => ({ workerId: `w${i + 1}`, name: `Worker ${i + 1}`, kind: 'worker', status: 'done', ticket: `VS-${i + 1}`, branch: `ac/vs-${i + 1}-done`, hasWorktree: true })),
    reclaimed: dryRun ? [] : [{ workerId: 'w1', name: 'Backend Engineer #1', kind: 'worker', status: 'done', ticket: 'VS-1', branch: 'ac/vs-1-done', hasWorktree: true }],
    skipped: [{ workerId: 'w2', directory: 'w2', name: 'Old Worker', kind: 'worker', status: 'done', reason: 'no landed proof', detail: 'no merged pull request' }],
    failed: [],
  });

  it('defaults to a real run and reports what was reclaimed and kept', async () => {
    routes['POST /api/w/ws1/workers/prune-homes'] = () => ({ body: result(false) });
    const { out } = await cli('worker', 'prune-homes');
    expect(calls.find((c) => c.path.endsWith('/workers/prune-homes'))?.body).toEqual({ dryRun: false, ignoreAge: false });
    expect(out).toContain('reclaimed');
    expect(out).toContain('w1');
    expect(out).toContain('no landed proof');
  });

  it('deletes nothing with --dry-run and says what it would do', async () => {
    routes['POST /api/w/ws1/workers/prune-homes'] = () => ({ body: result(true) });
    const { out } = await cli('worker', 'prune-homes', '--dry-run');
    expect(calls.find((c) => c.path.endsWith('/workers/prune-homes'))?.body).toEqual({ dryRun: true, ignoreAge: false });
    expect(out).toContain('would be reclaimed');
    expect(out).toContain('ac/vs-1-done');
  });

  it('--ignore-age says what it widens before deleting, then runs with the flag', async () => {
    routes['POST /api/w/ws1/workers/prune-homes'] = (raw) => {
      const b = raw as { dryRun: boolean; ignoreAge: boolean };
      return { body: result(b.dryRun, b.ignoreAge, b.ignoreAge ? 3 : 1) };
    };
    const { out } = await cli('worker', 'prune-homes', '--ignore-age');
    expect(out).toContain('ignoring the 30-day window: 2 more home(s) become eligible');
    const posts = calls.filter((c) => c.path.endsWith('/workers/prune-homes')).map((c) => c.body);
    expect(posts).toEqual([
      { dryRun: true, ignoreAge: false },
      { dryRun: true, ignoreAge: true },
      { dryRun: false, ignoreAge: true },
    ]);
  });

  it('--dry-run --ignore-age lists the wider set and deletes nothing', async () => {
    routes['POST /api/w/ws1/workers/prune-homes'] = (raw) => ({ body: result(true, (raw as { ignoreAge: boolean }).ignoreAge, 3) });
    const { out } = await cli('worker', 'prune-homes', '--dry-run', '--ignore-age');
    expect(calls.filter((c) => c.path.endsWith('/workers/prune-homes'))).toHaveLength(1);
    expect(calls[0]!.body).toEqual({ dryRun: true, ignoreAge: true });
    expect(out).toContain('ignoring the 30-day window');
    expect(out).toContain('would be reclaimed');
  });
});
