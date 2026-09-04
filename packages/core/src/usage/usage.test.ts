import { afterEach, describe, expect, it } from 'vitest';
import { newId, nowIso } from '@agent-conductor/db';
import { OcError } from '@agent-conductor/shared';
import { makeHarness, type TestHarness } from '../testing/context.js';
import { createUsageService } from './index.js';
import { recordUsage, type RecordUsageInput } from './service.js';

let h: TestHarness;
afterEach(() => h?.cleanup());

function usage(): ReturnType<typeof createUsageService> {
  return createUsageService(h.ctx, h.deps);
}

let ticketNumber = 0;
function mkTicket(over: Record<string, unknown> = {}): { id: string; identifier: string } {
  const id = newId();
  const n = ++ticketNumber;
  const ts = nowIso();
  h.db.insert('tickets', {
    id, workspaceId: h.workspaceId, projectId: h.projectId, number: n, identifier: `TST-${n}`, kind: 'change',
    title: `Ticket ${n}`, description: '', status: 'todo', priority: 'medium', createdByKind: 'human',
    createdAt: ts, updatedAt: ts, ...over,
  });
  return { id, identifier: (over.identifier as string) ?? `TST-${n}` };
}

function add(over: Partial<RecordUsageInput> = {}): void {
  recordUsage(h.ctx, {
    agentId: h.conductorId, runId: newId(), runtimeId: 'claude', projectId: h.projectId, roleId: h.roleId,
    model: 'claude-opus-5', provider: 'anthropic', inputTokens: 100, outputTokens: 10, costCents: 1, durationMs: 1000,
    ...over,
  });
}

const DAY = '2026-01-05'; // a Monday

describe('usage series', () => {
  it('buckets rows by hour and only emits buckets that have rows', () => {
    h = makeHarness();
    add({ occurredAt: `${DAY}T00:10:00.000Z`, runId: 'r1', inputTokens: 10, outputTokens: 1 });
    add({ occurredAt: `${DAY}T00:50:00.000Z`, runId: 'r1', inputTokens: 20, outputTokens: 2 });
    add({ occurredAt: `${DAY}T01:00:00.000Z`, runId: 'r2', inputTokens: 30, outputTokens: 3 });
    // outside the window
    add({ occurredAt: `${DAY}T03:00:00.000Z`, runId: 'r3' });

    const res = usage().series({ scope: 'workspace', window: 'custom', grain: 'hour', start: `${DAY}T00:00:00.000Z`, end: `${DAY}T02:00:00.000Z` });
    expect(res.points.map((p) => p.bucket)).toEqual([`${DAY}T00:00:00.000Z`, `${DAY}T01:00:00.000Z`]);
    expect(res.points[0]!.tokensIn).toBe(30);
    expect(res.points[0]!.runs).toBe(1); // two rows, one distinct run
    expect(res.points[1]!.tokensIn).toBe(30);
    expect(res.total.tokensIn).toBe(60);
    expect(res.total.tokensOut).toBe(6);
    expect(res.total.runs).toBe(2);
    expect(res.total.bucket).toBe(res.range.start);
  });

  it('buckets by day and by week', () => {
    h = makeHarness();
    add({ occurredAt: '2026-01-05T23:59:59.000Z', inputTokens: 5 });   // Mon
    add({ occurredAt: '2026-01-06T00:00:00.000Z', inputTokens: 7 });   // Tue
    add({ occurredAt: '2026-01-13T12:00:00.000Z', inputTokens: 9 });   // next Tue

    const byDay = usage().series({ scope: 'workspace', window: 'custom', grain: 'day', start: '2026-01-05T00:00:00.000Z', end: '2026-01-20T00:00:00.000Z' });
    expect(byDay.points.map((p) => p.bucket)).toEqual(['2026-01-05T00:00:00.000Z', '2026-01-06T00:00:00.000Z', '2026-01-13T00:00:00.000Z']);

    const byWeek = usage().series({ scope: 'workspace', window: 'custom', grain: 'week', start: '2026-01-05T00:00:00.000Z', end: '2026-01-20T00:00:00.000Z' });
    expect(byWeek.points.map((p) => p.bucket)).toEqual(['2026-01-05T00:00:00.000Z', '2026-01-12T00:00:00.000Z']);
    expect(byWeek.points[0]!.tokensIn).toBe(12);
    expect(byWeek.points[1]!.tokensIn).toBe(9);
  });

  it('compares against the previous window of the same span', () => {
    h = makeHarness();
    add({ occurredAt: `${DAY}T01:00:00.000Z`, inputTokens: 100 });     // in window
    add({ occurredAt: '2026-01-04T23:00:00.000Z', inputTokens: 40 });  // previous window
    add({ occurredAt: '2026-01-03T00:00:00.000Z', inputTokens: 999 }); // before both

    const res = usage().series({ scope: 'workspace', window: 'custom', grain: 'hour', start: `${DAY}T00:00:00.000Z`, end: `${DAY}T02:00:00.000Z` });
    expect(res.range.prevStart).toBe('2026-01-04T22:00:00.000Z');
    expect(res.range.prevEnd).toBe(`${DAY}T00:00:00.000Z`);
    expect(res.total.tokensIn).toBe(100);
    expect(res.previous.tokensIn).toBe(40);
    expect(res.previous.bucket).toBe(res.range.prevStart);
  });

  it('reports the share of cost that the runtime reported', () => {
    h = makeHarness();
    add({ occurredAt: `${DAY}T01:00:00.000Z`, costCents: 30 });                              // reported
    add({ occurredAt: `${DAY}T01:10:00.000Z`, costCents: null, inputTokens: 2_000_000, outputTokens: 0 }); // estimated -> 1000c
    const res = usage().series({ scope: 'workspace', window: 'custom', grain: 'hour', start: `${DAY}T00:00:00.000Z`, end: `${DAY}T02:00:00.000Z` });
    expect(res.total.costCents).toBe(1030);
    expect(res.total.costReportedCents).toBe(30);
    expect(res.costReportedShare).toBeCloseTo(30 / 1030);

    const empty = usage().series({ scope: 'workspace', window: 'custom', grain: 'hour', start: '2020-01-01T00:00:00.000Z', end: '2020-01-02T00:00:00.000Z' });
    expect(empty.points).toEqual([]);
    expect(empty.costReportedShare).toBe(0);
  });

  it('rejects a custom window without start and end', () => {
    h = makeHarness();
    expect(() => usage().series({ scope: 'workspace', window: 'custom' })).toThrow(OcError);
  });
});

describe('usage scopes', () => {
  it('filters by project, role, worker, model and runtime', () => {
    h = makeHarness();
    const worker = h.addWorker(null);
    const when = `${DAY}T01:00:00.000Z`;
    add({ occurredAt: when, agentId: worker, model: 'claude-haiku-5', runtimeId: 'codex', inputTokens: 1 });
    add({ occurredAt: when, agentId: h.conductorId, projectId: null, roleId: null, inputTokens: 2 });

    const q = { window: 'custom' as const, grain: 'hour' as const, start: `${DAY}T00:00:00.000Z`, end: `${DAY}T02:00:00.000Z` };
    const u = usage();
    expect(u.series({ ...q, scope: 'workspace' }).total.tokensIn).toBe(3);
    expect(u.series({ ...q, scope: `project:${h.projectId}` }).total.tokensIn).toBe(1);
    expect(u.series({ ...q, scope: `role:${h.roleId}` }).total.tokensIn).toBe(1);
    expect(u.series({ ...q, scope: `worker:${worker}` }).total.tokensIn).toBe(1);
    expect(u.series({ ...q, scope: 'model:claude-haiku-5' }).total.tokensIn).toBe(1);
    expect(u.series({ ...q, scope: 'runtime:codex' }).total.tokensIn).toBe(1);
    expect(u.series({ ...q, scope: 'runtime:claude' }).total.tokensIn).toBe(2);
  });

  it('rolls a ticket scope up over the subtree, by id or identifier', () => {
    h = makeHarness();
    const parent = mkTicket();
    const child = mkTicket({ parentId: parent.id });
    const grandchild = mkTicket({ parentId: child.id });
    const other = mkTicket();
    const when = `${DAY}T01:00:00.000Z`;
    add({ occurredAt: when, ticketId: parent.id, inputTokens: 1 });
    add({ occurredAt: when, ticketId: child.id, inputTokens: 2 });
    add({ occurredAt: when, ticketId: grandchild.id, inputTokens: 4 });
    add({ occurredAt: when, ticketId: other.id, inputTokens: 8 });

    const q = { window: 'custom' as const, grain: 'hour' as const, start: `${DAY}T00:00:00.000Z`, end: `${DAY}T02:00:00.000Z` };
    expect(usage().series({ ...q, scope: `ticket:${parent.id}` }).total.tokensIn).toBe(7);
    expect(usage().series({ ...q, scope: `ticket:${parent.identifier}` }).total.tokensIn).toBe(7);
    expect(usage().series({ ...q, scope: `ticket:${child.identifier}` }).total.tokensIn).toBe(6);
  });

  it('rejects unknown scopes', () => {
    h = makeHarness();
    const q = { window: '7d' as const, grain: 'day' as const };
    expect(() => usage().series({ ...q, scope: 'nonsense' })).toThrow(/must be/);
    expect(() => usage().series({ ...q, scope: 'bogus:1' })).toThrow(/unknown usage scope/);
    expect(() => usage().series({ ...q, scope: 'project:' })).toThrow(OcError);
    try {
      usage().series({ ...q, scope: 'ticket:TST-999' });
      expect.unreachable('should have thrown');
    } catch (e) {
      expect((e as OcError).code).toBe('not_found');
    }
  });
});

describe('usage top / models / ticket', () => {
  it('groups by model and ticket with human labels, ordered by cost', () => {
    h = makeHarness();
    const t = mkTicket({ title: 'Fix the thing' });
    const when = nowIso();
    add({ occurredAt: when, model: 'claude-opus-5', ticketId: t.id, costCents: 10, inputTokens: 5 });
    add({ occurredAt: when, model: 'claude-haiku-5', ticketId: null, costCents: 90, inputTokens: 1 });

    const byModel = usage().top({ scope: 'workspace', window: '24h', by: 'model' });
    expect(byModel.map((r) => r.key)).toEqual(['claude-haiku-5', 'claude-opus-5']);
    expect(byModel[0]!.costCents).toBe(90);
    expect(byModel[0]!.label).toBe('claude-haiku-5');

    const byTicket = usage().top({ scope: 'workspace', window: '24h', by: 'ticket' });
    expect(byTicket.map((r) => r.key)).toEqual(['unknown', t.id]);
    expect(byTicket[1]!.label).toBe(`${t.identifier} Fix the thing`);
    expect(byTicket[0]!.label).toBe('unknown');

    const byRole = usage().top({ scope: 'workspace', window: '24h', by: 'role' });
    expect(byRole[0]!.label).toBe('Backend Engineer');
    const byProject = usage().top({ scope: 'workspace', window: '24h', by: 'project' });
    expect(byProject[0]!.label).toBe('API');
    const byWorker = usage().top({ scope: 'workspace', window: '24h', by: 'worker' });
    expect(byWorker[0]!.label).toBe('Conductor');
  });

  it('aggregates per model with provider', () => {
    h = makeHarness();
    const when = nowIso();
    add({ occurredAt: when, model: 'claude-opus-5', provider: 'anthropic', costCents: 5, inputTokens: 3 });
    add({ occurredAt: when, model: 'claude-opus-5', provider: 'anthropic', costCents: 5, inputTokens: 4 });
    add({ occurredAt: when, model: null, provider: null, costCents: 50, inputTokens: 1 });

    const rows = usage().models({ scope: 'workspace', window: '24h' });
    expect(rows[0]).toMatchObject({ model: 'unknown', provider: null, costCents: 50 });
    expect(rows[1]).toMatchObject({ model: 'claude-opus-5', provider: 'anthropic', costCents: 10, tokensIn: 7, runs: 2 });
  });

  it('reports a ticket total, subtree rollup and per-turn breakdown', () => {
    h = makeHarness();
    const parent = mkTicket();
    const child = mkTicket({ parentId: parent.id });
    add({ occurredAt: `${DAY}T01:00:00.000Z`, ticketId: parent.id, runId: 'run-a', inputTokens: 1, costCents: 2 });
    add({ occurredAt: `${DAY}T02:00:00.000Z`, ticketId: parent.id, runId: 'run-b', inputTokens: 3, costCents: 4 });
    add({ occurredAt: `${DAY}T03:00:00.000Z`, ticketId: child.id, runId: 'run-c', inputTokens: 5, costCents: 6 });

    const res = usage().ticket(parent.identifier);
    expect(res.total.tokensIn).toBe(4);
    expect(res.total.costCents).toBe(6);
    expect(res.subtree.tokensIn).toBe(9);
    expect(res.subtree.costCents).toBe(12);
    expect(res.turns).toHaveLength(2);
    expect(res.turns.map((t) => t.runId)).toEqual(['run-a', 'run-b']);
    expect(res.turns[0]).toMatchObject({ agentId: h.conductorId, model: 'claude-opus-5', occurredAt: `${DAY}T01:00:00.000Z`, runs: 1, tokensIn: 1 });
  });
});

describe('recordUsage', () => {
  it('marks a runtime-reported cost as reported', async () => {
    h = makeHarness();
    const ev = recordUsage(h.ctx, { agentId: h.conductorId, runId: 'r', runtimeId: 'claude', model: 'claude-opus-5', inputTokens: 10, outputTokens: 5, costCents: 42 });
    expect(ev.costStatus).toBe('reported');
    expect(ev.costCents).toBe(42);
    await Promise.resolve(); // the bus delivers on a microtask
    expect(h.events.at(-1)).toMatchObject({ type: 'usage.recorded', entityType: 'usage', entityId: ev.id });
    const activity = h.db.get<{ action: string; entityId: string }>('SELECT action, entity_id FROM activity ORDER BY created_at DESC LIMIT 1');
    expect(activity).toMatchObject({ action: 'usage.recorded', entityId: ev.id });
  });

  it('estimates cost from the pricing table when the runtime reports none', () => {
    h = makeHarness();
    const ev = recordUsage(h.ctx, { agentId: h.conductorId, runId: 'r', runtimeId: 'claude', model: 'claude-opus-5', inputTokens: 200_000, outputTokens: 100_000 });
    expect(ev.costStatus).toBe('estimated');
    expect(ev.costCents).toBe(350); // 200k * $5/M + 100k * $25/M = $3.50
  });

  it('honours workspace pricing overrides', () => {
    h = makeHarness({ config: { pricingOverrides: { 'mystery-1': { inputPerMTok: 10, outputPerMTok: 0 } } } });
    const ev = recordUsage(h.ctx, { agentId: h.conductorId, runId: 'r', runtimeId: 'claude', model: 'mystery-1', inputTokens: 1_000_000, outputTokens: 0 });
    expect(ev.costStatus).toBe('estimated');
    expect(ev.costCents).toBe(1000);
  });

  it('leaves an unknown model unpriced but keeps the tokens', () => {
    h = makeHarness();
    const ev = recordUsage(h.ctx, { agentId: h.conductorId, runId: 'r', runtimeId: 'claude', model: 'who-knows-9', inputTokens: 11, cachedInputTokens: 3, outputTokens: 7 });
    expect(ev.costStatus).toBe('unpriced');
    expect(ev.costCents).toBeNull();
    const row = h.db.get<{ inputTokens: number; cachedInputTokens: number; outputTokens: number; billingType: string; costStatus: string }>(
      'SELECT input_tokens, cached_input_tokens, output_tokens, billing_type, cost_status FROM usage_events WHERE id = ?', [ev.id],
    );
    expect(row).toMatchObject({ inputTokens: 11, cachedInputTokens: 3, outputTokens: 7, billingType: 'unknown', costStatus: 'unpriced' });
  });
});
