/**
 * `ac_run_inspect` / `ac_run_list` — the conductor's read of a run it does not own (VS-61).
 * The tools are exercised through `runTool`, the same entry the MCP endpoint and the agent route use.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { Run, RunEvent, RunEventType, ToolResult } from '@agent-conductor/shared';
import { runTool, type ToolCtx } from '../src/tools.js';
import type { RunTokenClaims } from '../src/runtoken.js';
import { MAX_PAYLOAD_BYTES } from '../src/inspect.js';
import { makeHarness, ticket, type Harness } from './fakes.js';

let harness: Harness | null = null;
afterEach(async () => { await harness?.close(); harness = null; });

const CONDUCTOR: RunTokenClaims = { workspaceId: 'ws1', runId: 'run_c', agentId: 'ag_conductor', agentKind: 'conductor', projectId: null, ticketId: null, roleId: null };
const WORKER: RunTokenClaims = { workspaceId: 'ws1', runId: 'run_1', agentId: 'ag_1', agentKind: 'worker', projectId: 'proj1', ticketId: 'tk_1', roleId: 'role_1' };

function run(over: Partial<Run> = {}): Run {
  return {
    id: 'run_1', workspaceId: 'ws1', agentId: 'ag_1', ticketId: 'tk_1', sessionId: 'sess', wakeupIds: [],
    runtimeId: 'claude', model: 'claude-opus-5', status: 'running', turnEpoch: 3, cwd: '/tmp/ws',
    startedAt: '2026-09-05T12:00:00.000Z', finishedAt: null, exitCode: null, signal: null, pid: 4242, pgid: 4242,
    errorCode: null, errorFamily: null, retryOfRunId: null, usage: null, costCents: null, result: null,
    liveness: null, logPath: null, summary: null, createdAt: '2026-09-05T12:00:00.000Z',
    ...over,
  };
}

const worker = (over: Record<string, unknown> = {}) => ({
  id: 'ag_1', workspaceId: 'ws1', kind: 'worker', projectId: 'proj1', roleId: 'role_1', ticketId: 'tk_1',
  name: 'Backend Engineer #7', runtimeId: 'claude', model: null, status: 'running', pauseReason: null,
  errorText: null, homePath: '/tmp/home', worktreePath: '/tmp/wt', branch: 'ac/acme-42', turnEpoch: 3,
  turnCount: 3, spawnedBy: 'system', lastRunAt: '2026-09-05T12:00:00.000Z', ...over,
});

let seq = 0;
function ev(type: RunEventType, payload: Record<string, unknown>, ts = '2026-09-05T12:00:00.000Z'): RunEvent {
  seq += 1;
  return { id: `e${seq}`, runId: 'run_1', seq, ts, type, stream: 'stdout', level: 'info', payload };
}

/** Wire a run, its worker and an event store into the harness's service doubles. */
function seed(h: Harness, events: RunEvent[], theRun: Run = run(), workers: Record<string, unknown>[] = [worker()]): void {
  const runs = [theRun];
  h.impls.runs!.get = (id: string) => {
    const found = runs.find((r) => r.id === id);
    if (!found) throw new (Error as never)();
    return found;
  };
  h.impls.runs!.list = (filter: { agentId?: string; ticketId?: string; limit?: number } = {}) => {
    const items = runs.filter((r) => (!filter.agentId || r.agentId === filter.agentId) && (!filter.ticketId || r.ticketId === filter.ticketId));
    return { items: items.slice(0, filter.limit ?? 50), total: items.length };
  };
  h.impls.runs!.events = (id: string, after = 0, limit = 500) => events.filter((e) => e.runId === id && e.seq > after).slice(0, limit);
  h.impls.runs!.tail = (id: string, limit = 50) => events.filter((e) => e.runId === id).slice(-limit);
  h.impls.runs!.phaseTimings = (id: string) => events.filter((e) => e.runId === id && e.type === 'run.phase.timing');
  h.impls.workers!.get = (id: string) => {
    const found = workers.find((w) => w.id === id);
    if (!found) throw new (Error as never)();
    return found;
  };
  h.impls.roles!.get = (id: string) => ({ id, name: 'Backend Engineer' });
}

/** Replace the run list wholesale, for the retry-ladder cases. */
function seedRuns(h: Harness, runs: Run[]): void {
  h.impls.runs!.list = (filter: { agentId?: string; ticketId?: string; limit?: number } = {}) => {
    const items = runs.filter((r) => (!filter.agentId || r.agentId === filter.agentId) && (!filter.ticketId || r.ticketId === filter.ticketId));
    return { items: items.slice(0, filter.limit ?? 50), total: items.length };
  };
}

const ctxFor = (h: Harness, claims: RunTokenClaims): ToolCtx =>
  ({ ws: h.runtime, claims, actor: { kind: 'agent', id: claims.agentId, runId: claims.runId } });

const call = async (h: Harness, tool: string, input: unknown, claims: RunTokenClaims = CONDUCTOR): Promise<ToolResult<never>> =>
  runTool(tool, ctxFor(h, claims), input) as Promise<ToolResult<never>>;

/** A run that has prepared, built its prompt and is now working. */
function workingRun(): RunEvent[] {
  seq = 0;
  return [
    ev('run.started', { runtimeId: 'claude', model: 'claude-opus-5' }),
    ev('run.phase.timing', { phase: 'prepare_home', ms: 40 }),
    ev('run.phase.timing', { phase: 'prepare_worktree', ms: 900 }),
    ev('run.phase.timing', { phase: 'build_prompt', ms: 120 }),
    ev('assistant.text', { text: 'Rebasing onto main, then running the suite.' }),
    ev('tool.call', { name: 'Bash', id: 'c1', input: { command: 'pnpm test' } }),
    ev('tool.result', { id: 'c1', output: '186 passed', durationMs: 5000 }),
  ];
}

describe('ac_run_inspect — resolving a reference', () => {
  it('resolves a ticket identifier to the run behind it', async () => {
    harness = makeHarness();
    seed(harness, workingRun());

    const res = await call(harness, 'ac_run_inspect', { ref: 'ACME-42' });

    expect(res.ok).toBe(true);
    const d = res.data as Record<string, never>;
    expect(d['resolved']).toEqual({ kind: 'ticket', id: 'tk_1' });
    expect((d['run'] as Record<string, unknown>)['id']).toBe('run_1');
  });

  it('resolves a worker id and a run id to the same run', async () => {
    harness = makeHarness();
    seed(harness, workingRun());

    const byWorker = await call(harness, 'ac_run_inspect', { ref: 'ag_1' });
    const byRun = await call(harness, 'ac_run_inspect', { ref: 'run_1' });

    expect((byWorker.data as Record<string, never>)['resolved']).toEqual({ kind: 'worker', id: 'ag_1' });
    expect((byRun.data as Record<string, never>)['resolved']).toEqual({ kind: 'run', id: 'run_1' });
    for (const res of [byWorker, byRun]) {
      expect(((res.data as Record<string, never>)['run'] as Record<string, unknown>)['id']).toBe('run_1');
    }
  });

  it('fails as not_found for a reference that matches nothing', async () => {
    harness = makeHarness();
    seed(harness, workingRun());

    const res = await call(harness, 'ac_run_inspect', { ref: 'ACME-999' });

    expect(res.ok).toBe(false);
    expect(res.error?.code).toBe('not_found');
  });

  it('reports a ticket no worker has ever run rather than failing', async () => {
    harness = makeHarness();
    seed(harness, []);
    harness.tickets.set('tk_2', ticket({ id: 'tk_2', identifier: 'ACME-77', workerId: null }));
    seedRuns(harness, []);

    const res = await call(harness, 'ac_run_inspect', { ref: 'ACME-77' });

    expect(res.ok).toBe(true);
    const d = res.data as Record<string, never>;
    expect(d['run']).toBeNull();
    expect(d['transcript']).toEqual([]);
    expect(d['note']).toContain('no run');
  });
});

describe('ac_run_inspect — phase and elapsed', () => {
  it('names the phase under way and the phases already done', async () => {
    harness = makeHarness();
    seed(harness, workingRun());

    const d = (await call(harness, 'ac_run_inspect', { ref: 'ACME-42' })).data as Record<string, never>;
    const phase = d['phase'] as { current: string; completed: Array<{ phase: string; durationMs: number }> };

    expect(phase.current).toBe('turn');
    expect(phase.completed).toEqual([
      { phase: 'prepare_home', durationMs: 40 },
      { phase: 'prepare_worktree', durationMs: 900 },
      { phase: 'build_prompt', durationMs: 120 },
    ]);
  });

  it('is in the first phase before any phase has finished', async () => {
    harness = makeHarness();
    seed(harness, [ev('run.started', {})]);

    const d = (await call(harness, 'ac_run_inspect', { ref: 'run_1' })).data as Record<string, never>;
    expect((d['phase'] as { current: string }).current).toBe('prepare_home');
  });

  it('reports no current phase once the run has finished, and a fixed elapsed time', async () => {
    harness = makeHarness();
    const finished = run({ status: 'succeeded', finishedAt: '2026-09-05T12:04:00.000Z', liveness: 'advanced', summary: 'Ticked tasks 1-3.' });
    seed(harness, [...workingRun(), ev('run.phase.timing', { phase: 'finalize', ms: 60 })], finished);

    const d = (await call(harness, 'ac_run_inspect', { ref: 'run_1' })).data as Record<string, never>;

    expect((d['phase'] as { current: string | null }).current).toBeNull();
    expect(d['run']).toMatchObject({ status: 'succeeded', elapsedMs: 240_000, elapsed: '4m00s', liveness: 'advanced', turn: 3 });
  });
});

describe('ac_run_inspect — the worker and the transcript', () => {
  it('returns the worker status, its pause reason and its ticket', async () => {
    harness = makeHarness();
    seed(harness, workingRun(), run(), [worker({ status: 'paused', pauseReason: 'usage limit until 14:00' })]);

    const d = (await call(harness, 'ac_run_inspect', { ref: 'ACME-42' })).data as Record<string, never>;

    expect(d['worker']).toMatchObject({
      id: 'ag_1', name: 'Backend Engineer #7', status: 'paused', pauseReason: 'usage limit until 14:00', role: 'Backend Engineer',
      ticket: { identifier: 'ACME-42', title: 'Add dark mode', status: 'in_progress' },
    });
  });

  it('renders the transcript compactly: one line per tool call, phase markers in full', async () => {
    harness = makeHarness();
    seed(harness, workingRun());

    const d = (await call(harness, 'ac_run_inspect', { ref: 'ACME-42' })).data as Record<string, never>;
    const lines = d['transcript'] as Array<{ seq: number; kind: string; text: string }>;

    expect(lines.map((l) => l.kind)).toEqual(['status', 'phase', 'phase', 'phase', 'text', 'tool']);
    expect(lines.at(-1)!.text).toBe('Bash pnpm test 5s');
    expect(lines.at(-1)!.text).not.toContain('186 passed');
    expect(lines[1]!.text).toBe('phase: preparing home · 40ms');
    expect(lines.every((l) => typeof l.seq === 'number')).toBe(true);
  });

  it('redacts a secret the run recorded', async () => {
    harness = makeHarness();
    seq = 0;
    seed(harness, [ev('assistant.text', { text: 'Exporting GITHUB_TOKEN=ghp_abcdefghijklmnopqrstuvwxyz0123 now.' })]);

    const d = (await call(harness, 'ac_run_inspect', { ref: 'run_1' })).data as Record<string, never>;
    const body = JSON.stringify(d['transcript']);

    expect(body).not.toContain('ghp_abcdefghijklmnopqrstuvwxyz0123');
    expect(body).toContain('[redacted]');
  });
});

describe('ac_run_inspect — the cursor', () => {
  /** `count` assistant lines, so every event becomes its own block. */
  function chatter(count: number, chars = 20): RunEvent[] {
    seq = 0;
    return Array.from({ length: count }, (_, i) => ev('tool.call', { name: 'Read', id: `c${i}`, input: { file_path: `${'f'.repeat(chars)}${i}.ts` } }));
  }

  it('returns the newest entries by default and says where to resume', async () => {
    harness = makeHarness();
    seed(harness, chatter(100));

    const d = (await call(harness, 'ac_run_inspect', { ref: 'run_1' })).data as Record<string, never>;
    const cursor = d['cursor'] as Record<string, unknown>;
    const lines = d['transcript'] as Array<{ seq: number }>;

    expect(lines).toHaveLength(40);
    expect(lines[0]!.seq).toBe(61);
    expect(lines.at(-1)!.seq).toBe(100);
    // A tail already ends at the newest event: what it misses is older, reached with a lower `since`.
    expect(cursor).toMatchObject({ totalEvents: 100, firstSeq: 61, lastSeq: 100, truncated: true, resumeFrom: null, omittedBefore: 60 });
    expect(cursor['note']).toContain('page back with a lower since');
  });

  it('pages forward from since, returning only later entries', async () => {
    harness = makeHarness();
    seed(harness, chatter(100));

    const d = (await call(harness, 'ac_run_inspect', { ref: 'run_1', since: 10, limit: 5 })).data as Record<string, never>;
    const lines = d['transcript'] as Array<{ seq: number }>;

    expect(lines.map((l) => l.seq)).toEqual([11, 12, 13, 14, 15]);
    expect(d['cursor']).toMatchObject({ truncated: true, resumeFrom: 15 });
  });

  it('starts from the beginning of the run for full', async () => {
    harness = makeHarness();
    seed(harness, chatter(12));

    const d = (await call(harness, 'ac_run_inspect', { ref: 'run_1', full: true })).data as Record<string, never>;
    const lines = d['transcript'] as Array<{ seq: number }>;

    expect(lines[0]!.seq).toBe(1);
    expect(lines).toHaveLength(12);
    expect(d['cursor']).toMatchObject({ truncated: false, resumeFrom: null });
  });

  it('refuses a limit above the maximum instead of answering unbounded', async () => {
    harness = makeHarness();
    seed(harness, chatter(10));

    const res = await call(harness, 'ac_run_inspect', { ref: 'run_1', limit: 500 });

    expect(res.ok).toBe(false);
    expect(res.error?.code).toBe('validation');
  });

  it('holds the payload under the cap, dropping the oldest entries of a tail read', async () => {
    harness = makeHarness();
    seed(harness, chatter(200, 4000));

    const d = (await call(harness, 'ac_run_inspect', { ref: 'run_1', limit: 200 })).data as Record<string, never>;
    const cursor = d['cursor'] as Record<string, unknown>;
    const lines = d['transcript'] as Array<{ seq: number }>;

    expect(JSON.stringify(d['transcript']).length).toBeLessThanOrEqual(MAX_PAYLOAD_BYTES);
    expect(cursor['omittedBefore']).toBeGreaterThan(0);
    expect(cursor['truncated']).toBe(true);
    expect(lines.at(-1)!.seq).toBe(200);          // the newest entries are the ones kept
    expect(cursor['note']).toContain('size cap');
  });

  it('keeps a single oversized entry, shortened, rather than returning nothing', async () => {
    harness = makeHarness();
    seq = 0;
    seed(harness, [ev('assistant.text', { text: 'z'.repeat(200_000) })]);

    const d = (await call(harness, 'ac_run_inspect', { ref: 'run_1' })).data as Record<string, never>;
    const lines = d['transcript'] as Array<{ text: string }>;

    expect(lines).toHaveLength(1);
    expect(JSON.stringify(d['transcript']).length).toBeLessThanOrEqual(MAX_PAYLOAD_BYTES);
  });
});

describe('ac_run_list', () => {
  it('lists the retry ladder newest first, each naming the run it retried', async () => {
    harness = makeHarness();
    seed(harness, workingRun());
    seedRuns(harness, [
      run({ id: 'run_3', status: 'running', turnEpoch: 3, retryOfRunId: 'run_2', startedAt: '2026-09-05T12:10:00.000Z' }),
      run({ id: 'run_2', status: 'failed', turnEpoch: 2, retryOfRunId: 'run_1', errorFamily: 'transient_upstream', errorCode: 'net', liveness: 'failed', startedAt: '2026-09-05T12:05:00.000Z', finishedAt: '2026-09-05T12:06:00.000Z' }),
      run({ id: 'run_1', status: 'failed', turnEpoch: 1, errorFamily: 'transient_upstream', errorCode: 'net', startedAt: '2026-09-05T12:00:00.000Z', finishedAt: '2026-09-05T12:01:00.000Z' }),
    ]);

    const res = await call(harness, 'ac_run_list', { ref: 'ACME-42' });
    const d = res.data as Record<string, never>;
    const runs = d['runs'] as Array<Record<string, unknown>>;

    expect(runs.map((r) => r['id'])).toEqual(['run_3', 'run_2', 'run_1']);
    expect(runs[1]).toMatchObject({ status: 'failed', retryOfRunId: 'run_1', errorFamily: 'transient_upstream', elapsed: '1m00s', liveness: 'failed' });
    expect(d['total']).toBe(3);
  });

  it('returns an empty list for a ticket that has never run', async () => {
    harness = makeHarness();
    seed(harness, []);
    seedRuns(harness, []);

    const res = await call(harness, 'ac_run_list', { ref: 'ACME-42' });

    expect(res.ok).toBe(true);
    expect((res.data as Record<string, never>)['runs']).toEqual([]);
  });

  it('refuses a limit above the maximum', async () => {
    harness = makeHarness();
    seed(harness, []);

    expect((await call(harness, 'ac_run_list', { ref: 'ACME-42', limit: 500 })).error?.code).toBe('validation');
  });
});

describe('scope', () => {
  it('refuses both tools to a worker', async () => {
    harness = makeHarness();
    seed(harness, workingRun());

    for (const tool of ['ac_run_inspect', 'ac_run_list']) {
      const res = await call(harness, tool, { ref: 'ACME-42' }, WORKER);
      expect(res.ok).toBe(false);
      expect(res.error?.code).toBe('forbidden');
      expect(res.error?.message).toContain(tool);
      expect(JSON.stringify(res)).not.toContain('pnpm test');
    }
  });

  it('lets the conductor inspect a run of its own', async () => {
    harness = makeHarness();
    seq = 0;
    const own = run({ id: 'run_c', agentId: 'ag_conductor', ticketId: null });
    seed(harness, [{ ...ev('assistant.text', { text: 'Filed VS-61.' }), runId: 'run_c' }], own, [worker({ id: 'ag_conductor', kind: 'conductor', name: 'Conductor', roleId: null, ticketId: null })]);

    const res = await call(harness, 'ac_run_inspect', { ref: 'run_c' });

    expect(res.ok).toBe(true);
    const d = res.data as Record<string, never>;
    expect((d['worker'] as Record<string, unknown>)['kind']).toBe('conductor');
    expect((d['transcript'] as Array<{ text: string }>)[0]!.text).toBe('Filed VS-61.');
  });
});
