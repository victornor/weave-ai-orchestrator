import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RunEvent } from '@weave-ai/shared';
import { makeHarness, type TestHarness } from '../testing/context.js';
import { ACTIVITY_PUSH_MS, createWorkerActivityService } from './index.js';

/** Let the EventBus's queued microtask deliver. */
const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

function ev(over: Partial<RunEvent> & { type: RunEvent['type']; payload: Record<string, unknown> }): RunEvent {
  return { id: '1', runId: 'r1', seq: 1, ts: '2026-09-13T10:00:00.000Z', stream: 'stdout', level: 'info', ...over };
}

let h: TestHarness;
afterEach(() => { h?.cleanup(); vi.useRealTimers(); });

describe('WorkerActivityService (VS-328)', () => {
  it('sets, keeps and clears the activity line', () => {
    h = makeHarness({ bare: true });
    const a = createWorkerActivityService(h.ctx);
    const agentId = h.addWorker(null);

    a.observe(agentId, null, ev({ type: 'tool.call', payload: { name: 'Edit', input: { file_path: 'src/a.ts' } }, ts: '2026-09-13T10:00:00.000Z' }));
    expect(a.summaryFor(agentId)?.activity).toMatchObject({ verb: 'editing', since: '2026-09-13T10:00:00.000Z' });

    a.observe(agentId, null, ev({ type: 'tool.call', payload: { name: 'Edit', input: { file_path: 'src/a.ts' } }, ts: '2026-09-13T10:00:05.000Z' }));
    expect(a.summaryFor(agentId)?.activity?.since).toBe('2026-09-13T10:00:00.000Z');

    a.observe(agentId, null, ev({ type: 'command.executed', payload: { command: 'pnpm test' }, ts: '2026-09-13T10:00:06.000Z' }));
    expect(a.summaryFor(agentId)?.activity).toMatchObject({ verb: 'testing', since: '2026-09-13T10:00:06.000Z' });

    a.finish(agentId);
    expect(a.summaryFor(agentId)?.activity).toBeNull();
  });

  it('carries the live-turn state so a board card is never a bare "Working" (VS-602)', () => {
    h = makeHarness({ bare: true });
    const a = createWorkerActivityService(h.ctx);
    const agentId = h.addWorker(null);

    // Nothing observed yet: no live state.
    expect(a.summaryFor(agentId)?.live ?? null).toBeNull();

    // A running tool: the live state names it, with the elapsed seconds it has run.
    a.observe(agentId, null, ev({ type: 'tool.call', payload: { id: 't1', name: 'bash', input: { command: 'sleep 3; ls' } }, ts: new Date(Date.now() - 3000).toISOString() }));
    const running = a.summaryFor(agentId)?.live;
    expect(running).toMatchObject({ state: 'tool', label: 'Running bash sleep 3; ls', toolCount: 1, wholeStepsOnly: true });

    // The tool result flips it to "Working" rather than leaving a stale "Running".
    a.observe(agentId, null, ev({ type: 'tool.result', payload: { id: 't1', name: 'bash' }, ts: new Date().toISOString() }));
    expect(a.summaryFor(agentId)?.live).toMatchObject({ state: 'waiting', label: 'Working', toolCount: 1 });

    // The turn ends: the live state is gone.
    a.finish(agentId);
    expect(a.summaryFor(agentId)?.live ?? null).toBeNull();
  });

  it("reads whether a run can stream from its runtime's declared capability, not a table of ids (VS-615)", () => {
    h = makeHarness({ bare: true });
    const a = createWorkerActivityService(h.ctx);
    const now = new Date().toISOString();
    const streaming = { id: 'brand-new', capabilities: { partialOutput: 'full' } };
    const silent = { id: 'silent', capabilities: {} };
    h.ctx.registries.runtimes.set('brand-new', streaming as never);
    h.ctx.registries.runtimes.set('silent', silent as never);
    for (const [runId, runtimeId] of [['r-new', 'brand-new'], ['r-silent', 'silent']] as const) {
      const agentId = h.addWorker(null);
      h.db.insert('runs', { id: runId, workspaceId: h.workspaceId, agentId, ticketId: null, runtimeId, turnEpoch: 0, cwd: '/tmp', createdAt: now });
      a.observe(agentId, null, ev({ runId, type: 'tool.call', payload: { id: 't1', name: 'bash', input: { command: 'ls' } }, ts: now }));
      expect(a.summaryFor(agentId)?.live?.wholeStepsOnly).toBe(runtimeId === 'silent');
    }
  });

  it('keeps the last tally across a turn and replaces it with a newer one', () => {
    h = makeHarness({ bare: true });
    const a = createWorkerActivityService(h.ctx);
    const agentId = h.addWorker(null);

    a.observe(agentId, null, ev({ type: 'command.executed', payload: { command: 'pnpm test', tests: { passed: 28, total: 28 } } }));
    expect(a.summaryFor(agentId)?.tests).toEqual({ passed: 28, total: 28 });

    a.finish(agentId);
    expect(a.summaryFor(agentId)?.tests).toEqual({ passed: 28, total: 28 });

    a.observe(agentId, null, ev({ type: 'command.executed', payload: { command: 'pnpm test', tests: { passed: 30, total: 31 } } }));
    expect(a.summaryFor(agentId)?.tests).toEqual({ passed: 30, total: 31 });
  });

  it('pushes at most one update per worker per throttle window', async () => {
    vi.useFakeTimers();
    h = makeHarness({ bare: true });
    const a = createWorkerActivityService(h.ctx);
    const agentId = h.addWorker(null);
    const count = (): number => h.events.filter((e) => String(e.type) === 'worker.activity' && e.entityId === agentId).length;

    a.observe(agentId, null, ev({ type: 'tool.call', payload: { name: 'Edit', input: { file_path: 'a.ts' } } }));
    await vi.advanceTimersByTimeAsync(0);
    expect(count()).toBe(1);

    a.observe(agentId, null, ev({ type: 'tool.call', payload: { name: 'Read', input: { file_path: 'b.ts' } } }));
    a.observe(agentId, null, ev({ type: 'tool.call', payload: { name: 'Bash', input: { command: 'ls' } } }));
    await vi.advanceTimersByTimeAsync(0);
    expect(count()).toBe(1);

    await vi.advanceTimersByTimeAsync(ACTIVITY_PUSH_MS);
    expect(count()).toBe(2);
  });

  it('rebuilds the last tally from persisted events for a fresh service and stales none', () => {
    h = makeHarness({ bare: true });
    const agentId = h.addWorker(null);
    const now = new Date().toISOString();
    h.db.insert('runs', { id: 'run-1', workspaceId: h.workspaceId, agentId, ticketId: null, runtimeId: 'claude', turnEpoch: 0, cwd: '/tmp', createdAt: now });
    h.db.run('INSERT INTO run_events (run_id, seq, ts, type, stream, level, payload_json) VALUES (?,?,?,?,?,?,?)', ['run-1', 1, now, 'command.executed', 'stdout', 'info', JSON.stringify({ command: 'pnpm test', tests: { passed: 12, total: 14 } })]);

    const fresh = createWorkerActivityService(h.ctx);
    expect(fresh.summaryFor(agentId)?.tests).toEqual({ passed: 12, total: 14 });
    // A rebuilt summary never invents a live activity line.
    expect(fresh.summaryFor(agentId)?.activity).toBeNull();
  });

  it('broadcast emits without writing an events row', async () => {
    h = makeHarness({ bare: true });
    const before = h.db.get<{ n: number }>('SELECT COUNT(*) n FROM events')!.n;
    h.ctx.events.broadcast('worker.activity', 'worker', 'w1', { agentId: 'w1', ticketId: null, activity: null, tests: null });
    await flush();
    expect(h.db.get<{ n: number }>('SELECT COUNT(*) n FROM events')!.n).toBe(before);
    expect(h.events.some((e) => String(e.type) === 'worker.activity')).toBe(true);
  });
});
