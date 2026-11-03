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

describe('weave worker retained / reclaim (VS-955)', () => {
  const GB = 1024 ** 3;
  const copy = (over: Record<string, unknown>) => ({
    directory: 'w1', workerId: 'w1', workerName: 'Engineer #1', workerStatus: 'done', ticketId: 't1', ticketIdentifier: 'VS-349',
    ticketStatus: 'cancelled', projectId: 'p1', branch: 'ac/vs-349-x', headSha: 'abc', class: 'finished_unlanded', offerable: true,
    ageFrom: new Date(Date.now() - 50 * 86_400_000).toISOString(), bytes: 12 * GB, uncommitted: { tracked: 2, untracked: 3 },
    commitsNotOnLandingBranch: 0, commitsOnNoRemote: 0, commitsOnlyHere: 0, mergedPr: false, error: null,
    reasons: ['uncommitted'], needsOwnApproval: false, scannedAt: '2026-11-02T19:00:00.000Z', ...over,
  });
  const report = {
    scannedAt: '2026-11-02T19:00:00.000Z', scanning: false, offerDays: 30,
    totals: { count: 2, bytes: 16 * GB, offerable: { count: 1, bytes: 12 * GB }, byClass: {} },
    copies: [
      copy({}),
      copy({ directory: 'w2', ticketIdentifier: 'VS-900', ticketStatus: 'in_review', class: 'open', offerable: false, bytes: 4 * GB,
        reasons: ['commits_not_on_landing_branch'], uncommitted: { tracked: 0, untracked: 0 }, commitsNotOnLandingBranch: 4, commitsOnNoRemote: 1, needsOwnApproval: true }),
      copy({ directory: 'w3', ticketIdentifier: 'VS-340', ticketStatus: 'done', class: 'landing_unverified', offerable: false, bytes: 1 * GB,
        reasons: ['landing_unverified'], uncommitted: { tracked: 0, untracked: 0 }, commitsNotOnLandingBranch: null,
        landingNote: 'the project clone does not hold the recorded merge commit 4b37832e09e3' }),
    ],
    disk: { path: '/home', freeBytes: 24 * GB, totalBytes: 1600 * GB, low: true, thresholds: { freePercent: 10, freeBytes: 50 * GB }, checkedAt: 't' },
  };

  it('prints the copies largest first with size, class, age and why each is kept, and the totals', async () => {
    routes['GET /api/w/ws1/workers/retained'] = () => ({ body: report });
    const { out } = await cli('worker', 'retained');
    expect(out).toContain('12GB');
    expect(out).toContain('VS-349');
    expect(out).toContain('finished_unlanded *');
    expect(out).toContain('2 modified, 3 untracked');
    expect(out).toContain('4 commit(s) not landed (1 unpushed)');
    expect(out).toContain('own card');
    expect(out).toContain('landing_unverified');
    expect(out).toContain('merge recorded, not checkable: the project clone does not hold the recorded merge');
    expect(out).toContain('2 retained copies, 16GB; 1 offerable');
    expect(out).toContain('/home: 24GB free of 1.6TB (2%) — below the warning threshold');
  });

  it('--scan starts a scan and waits for it before printing', async () => {
    let reads = 0;
    routes['POST /api/w/ws1/workers/retained/scan'] = () => ({ status: 202, body: { started: true, scanning: true } });
    routes['GET /api/w/ws1/workers/retained'] = () => ({ body: { ...report, scanning: reads++ === 0 } });
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    const done = cli('worker', 'retained', '--scan');
    await vi.waitFor(() => expect(reads).toBe(1));
    await vi.advanceTimersByTimeAsync(2_000);
    vi.useRealTimers();
    const { out } = await done;
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      'POST /api/w/ws1/workers/retained/scan', 'GET /api/w/ws1/workers/retained', 'GET /api/w/ws1/workers/retained', 'GET /api/w/ws1/workers/retained',
    ]);
    expect(out).toContain('VS-349');
  });

  it('reclaim --offerable sends only the offerable copies and says nothing was removed', async () => {
    routes['GET /api/w/ws1/workers/retained'] = () => ({ body: report });
    routes['POST /api/w/ws1/workers/retained/reclaim'] = () => ({ body: { cards: [{ decisionId: 'dec_1', directories: ['w1'], bytes: 12 * GB, own: false }], skipped: [] } });
    const { out } = await cli('worker', 'reclaim', '--offerable');
    expect(calls.find((c) => c.path.endsWith('/retained/reclaim'))?.body).toEqual({ directories: ['w1'] });
    expect(out).toContain('dec_1');
    expect(out).toContain('nothing has been removed');
  });

  it('reclaim with named directories posts them as given', async () => {
    routes['POST /api/w/ws1/workers/retained/reclaim'] = () => ({ body: { cards: [], skipped: [{ directory: 'w2', reason: 'its ticket VS-900 is still in_review' }] } });
    const { out } = await cli('worker', 'reclaim', 'w2');
    expect(calls[0]!.body).toEqual({ directories: ['w2'] });
    expect(out).toContain('not offered w2: its ticket VS-900 is still in_review');
  });
});
