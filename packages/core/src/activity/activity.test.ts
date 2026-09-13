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
