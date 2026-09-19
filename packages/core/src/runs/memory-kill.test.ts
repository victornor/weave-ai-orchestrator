import { describe, expect, it } from 'vitest';
import type { Db } from '@weave-ai/db';
import type { WorkspaceContext } from '../context.js';
import type { CoreServices } from '../api.js';
import type { FinalizeInput } from './engine.js';
import { RETRYABLE, isMemoryKill, recordMemoryKill } from './engine.js';

const MB = 1024 * 1024;

function input(over: { signal?: string | null; exitCode?: number | null; peakBytes?: number | null; limitMb?: number; cancelled?: { mode: 'interrupt' | 'kill' } | null } = {}): FinalizeInput {
  return {
    cancelled: over.cancelled ?? null,
    memory: { limitMb: over.limitMb ?? 2048, peakBytes: 'peakBytes' in over ? over.peakBytes : 2200 * MB },
    result: { signal: over.signal === undefined ? 'SIGKILL' : over.signal, exitCode: over.exitCode === undefined ? null : over.exitCode },
  } as unknown as FinalizeInput;
}

describe('isMemoryKill (VS-579)', () => {
  it('reads a SIGKILL whose peak reached the limit as a memory kill', () => {
    expect(isMemoryKill(input(), null)).toBe(true);
    expect(isMemoryKill(input({ exitCode: 137, signal: null }), null)).toBe(true);
  });

  it('does not read a kill whose peak stayed below the limit', () => {
    expect(isMemoryKill(input({ peakBytes: 100 * MB }), null)).toBe(false);
  });

  it('never relabels a human cancel, a shutdown, or a watchdog cut', () => {
    expect(isMemoryKill(input({ cancelled: { mode: 'kill' } }), null)).toBe(false);
    expect(isMemoryKill(input(), { reason: 'drain', at: '2026-01-01T00:00:00.000Z' })).toBe(false);
  });

  it('does not read a plain non-zero exit or a SIGTERM as memory', () => {
    expect(isMemoryKill(input({ signal: null, exitCode: 1 }), null)).toBe(false);
    expect(isMemoryKill(input({ signal: 'SIGTERM', exitCode: null }), null)).toBe(false);
  });

  it('needs a contained scope and a readable peak', () => {
    expect(isMemoryKill({ cancelled: null, memory: null, result: { signal: 'SIGKILL', exitCode: null } } as unknown as FinalizeInput, null)).toBe(false);
    expect(isMemoryKill(input({ peakBytes: null }), null)).toBe(false);
  });
});

describe('memory-kill activity and incident (VS-579)', () => {
  function harness(priorKills: number, openIncidents: Array<{ ticketId: string | null; title: string }> = []) {
    const inserted: Array<{ sql: string; params: unknown[] }> = [];
    const db = {
      run: (sql: string, params: unknown[]) => { inserted.push({ sql, params }); },
      get: (sql: string) => (sql.includes('COUNT(*) n FROM runs') ? { n: priorKills } : undefined),
    } as unknown as Db;
    const ctx = { workspaceId: 'w1', db, log: () => ({ child: () => ({ warn: () => undefined }) }) } as unknown as WorkspaceContext;
    const created: Array<Record<string, unknown>> = [];
    const deps = () => ({
      incidents: {
        list: () => ({ items: openIncidents, total: openIncidents.length }),
        create: (i: Record<string, unknown>) => { created.push(i); return i; },
      },
    }) as unknown as CoreServices;
    const f = {
      agent: { id: 'a1', ticketId: 't1', projectId: 'p1', roleId: 'r1' },
      ticket: { identifier: 'TST-1' },
      memory: { limitMb: 2048, peakBytes: 2200 * MB },
    } as unknown as FinalizeInput;
    return { inserted, created, deps, ctx, f };
  }

  it('records an activity entry naming the peak on every kill', () => {
    const h = harness(0);
    recordMemoryKill(h.ctx, h.deps, h.f, 'run1', 'worker exceeded its memory limit');
    const activity = h.inserted.find((i) => i.sql.includes('INSERT INTO activity'));
    expect(activity).toBeDefined();
    expect(activity!.params[5]).toBe('worker.memory_limit');
    expect(activity!.params[9]).toBe('p1');
    expect(JSON.parse(activity!.params[10] as string)).toMatchObject({ peakMb: 2200, limitMb: 2048 });
  });

  it('files no incident on the first kill and one on the second', () => {
    const first = harness(0);
    recordMemoryKill(first.ctx, first.deps, first.f, 'run1', null);
    expect(first.created).toHaveLength(0);

    const second = harness(1);
    recordMemoryKill(second.ctx, second.deps, second.f, 'run2', 'worker exceeded its memory limit');
    expect(second.created).toHaveLength(1);
    expect(second.created[0]).toMatchObject({ reporterKind: 'system', ticketId: 't1', roleId: 'r1' });
    expect(String(second.created[0]!.evidence)).toContain('peak: 2200 MB');
  });

  it('does not file a second incident while one is open', () => {
    const h = harness(1, [{ ticketId: 't1', title: 'Worker memory limit repeated on TST-1' }]);
    recordMemoryKill(h.ctx, h.deps, h.f, 'run3', null);
    expect(h.created).toHaveLength(0);
  });

  it('makes a resource failure retryable', () => {
    expect(RETRYABLE).toContain('resource');
  });
});
