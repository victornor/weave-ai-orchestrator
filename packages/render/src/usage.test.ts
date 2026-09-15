import { describe, expect, it } from 'vitest';
import type { RuntimeAccount } from '@weave-ai/shared';
import { accountLimits, budgetMeter, contextStrip, contextTokens, costStatusFor, FIRST_REQUEST_MISS_THRESHOLD, firstRequest, MIXED_BILLING_NOTE, mixedBillingNote, resolveModel, runtimeLimitStrip, showCost, usageRows, usageTotals } from './usage.js';

const series = {
  range: { start: 's', end: 'e', window: '24h', grain: 'hour', prevStart: 'ps', prevEnd: 'pe' },
  points: [
    { bucket: '2026-09-04T10:00:00.000Z', tokensIn: 10_000, tokensOut: 2_000, tokensCached: 4_000, runs: 2, costCents: 20, costReportedCents: 20, durationMs: 1000 },
    { bucket: '2026-09-04T11:00:00.000Z', tokensIn: 5_000, tokensOut: 1_400, tokensCached: 1_000, runs: 1, costCents: 21, costReportedCents: 12, durationMs: 500 },
  ],
  total: { tokensIn: 15_000, tokensOut: 3_400, tokensCached: 5_000, runs: 3, costCents: 41, costReportedCents: 32, durationMs: 1500 },
  previous: { tokensIn: 12_000, tokensOut: 3_000, runs: 2, costCents: 30, costReportedCents: 30 },
  costReportedShare: 0.79,
};

describe('usageTotals', () => {
  it('formats totals, provenance and the window-over-window delta', () => {
    const t = usageTotals(series);
    expect(t.tokens).toBe('18.4k');
    expect(t.cost).toBe('$0.41 est');
    expect(t.costStatus).toBe('estimated');
    expect(t.reportedShare).toBe('79% reported');
    expect(t.tokensDelta).toBe('+23%');
    expect(t.costDelta).toBe('+37%');
    expect(t.runs).toBe(3);
  });

  it('labels fully reported cost without est', () => {
    const t = usageTotals({ total: { costCents: 41, costReportedCents: 41, tokensIn: 1, tokensOut: 1 }, previous: {} });
    expect(t.cost).toBe('$0.41');
    expect(t.costStatus).toBe('reported');
  });

  it('degrades on empty series', () => {
    const t = usageTotals(null);
    expect(t.tokens).toBe('0');
    expect(t.cost).toBe('—');
    expect(t.tokensDelta).toBe('—');
    expect(t.reportedShare).toBeNull();
  });

  it('classifies unpriced windows', () => {
    expect(costStatusFor({ costCents: 0 })).toBe('unpriced');
    expect(costStatusFor(null)).toBe('unpriced');
  });
});

describe('usageRows', () => {
  it('formats each bucket', () => {
    const rows = usageRows(series);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({ bucket: '2026-09-04T10:00:00.000Z', tokens: '12k', tokensIn: '10k', tokensOut: '2k', cost: '$0.20', runs: 2 });
    expect(usageRows(null)).toEqual([]);
  });
});

describe('budgetMeter', () => {
  it('turns amber near the budget or when curation is due', () => {
    expect(budgetMeter({ label: 'web · project KB', tokenEstimate: 7_200, budgetTokens: 12_000 })).toEqual({ text: 'web · project KB · 7.2k / 12k tok', pct: 0.6, tone: 'ok' });
    expect(budgetMeter({ label: 'x', tokenEstimate: 10_000, budgetTokens: 12_000 }).tone).toBe('warn');
    expect(budgetMeter({ label: 'x', tokenEstimate: 1, budgetTokens: 12_000, curationPending: true }).tone).toBe('warn');
    expect(budgetMeter({ label: 'x', tokenEstimate: 13_000, budgetTokens: 12_000 }).tone).toBe('over');
  });
});

describe('showCost', () => {
  it('shows cost when nothing is known about the billing mix', () => {
    expect(showCost(undefined)).toBe(true);
    expect(showCost(null)).toBe(true);
  });

  it('shows cost when any token in the window was metered', () => {
    expect(showCost({ subscription: 1000, metered: 1, unknown: 0 })).toBe(true);
  });

  it('shows cost when any token in the window is unattributed', () => {
    // Rows recorded before the runtime had a snapshot may well have been metered.
    expect(showCost({ subscription: 1000, metered: 0, unknown: 1 })).toBe(true);
  });

  it('hides cost only when the whole window was billed to a subscription', () => {
    expect(showCost({ subscription: 1000, metered: 0, unknown: 0 })).toBe(false);
  });

  it('shows cost for an empty window rather than hiding it on no evidence', () => {
    expect(showCost({ subscription: 0, metered: 0, unknown: 0 })).toBe(true);
  });
});

describe('accountLimits', () => {
  const now = new Date('2026-09-05T17:35:00.000Z');
  const subscription: RuntimeAccount = {
    workspaceId: 'ws', runtimeId: 'claude', billingType: 'subscription_included', planLabel: 'max',
    limitsAvailable: true,
    limits: [
      { kind: 'session', label: 'Session', utilization: 42, resetsAt: '2026-09-05T18:09:59.000Z', scopeLabel: null },
      { kind: 'weekly_all', label: 'Weekly', utilization: 23, resetsAt: '2026-09-10T01:59:59.000Z', scopeLabel: null },
      { kind: 'weekly_scoped', label: 'Weekly', utilization: 25.4, resetsAt: '2026-09-10T01:59:59.000Z', scopeLabel: 'Fable' },
    ],
    note: null, capturedAt: '2026-09-05T17:33:00.000Z',
  };

  it('renders the plan, each window with its reset, and the snapshot age', () => {
    expect(accountLimits([subscription], now)).toEqual([{
      runtimeId: 'claude',
      billingType: 'subscription_included',
      plan: 'max',
      limitsAvailable: true,
      probeFailed: false,
      windows: [
        { key: 'session:', label: 'Session', percent: 42, resetsIn: 'resets in 35m' },
        { key: 'weekly_all:', label: 'Weekly', percent: 23, resetsIn: 'resets in 4d' },
        { key: 'weekly_scoped:Fable', label: 'Weekly · Fable', percent: 25, resetsIn: 'resets in 4d' },
      ],
      note: null,
      age: '2m ago',
    }]);
  });

  it('carries the note and no windows when the account reports no limits', () => {
    const acc: RuntimeAccount = {
      ...subscription, runtimeId: 'codex', planLabel: null, limitsAvailable: false, limits: [],
      note: 'codex: the CLI keeps plan limits in its session rollout file',
    };
    expect(accountLimits([acc], now)[0]).toMatchObject({
      plan: 'subscription', limitsAvailable: false, windows: [], note: 'codex: the CLI keeps plan limits in its session rollout file',
    });
  });

  it('names the billing mode when the runtime reported no plan label', () => {
    const metered: RuntimeAccount = { ...subscription, billingType: 'metered_api', planLabel: null, limitsAvailable: false, limits: [], note: 'billed per token' };
    expect(accountLimits([metered], now)[0]?.plan).toBe('API key');
    expect(accountLimits([{ ...metered, billingType: 'unknown' }], now)[0]?.plan).toBe('unknown');
  });

  it('never reports limits as available when the window list is empty', () => {
    expect(accountLimits([{ ...subscription, limits: [] }], now)[0]?.limitsAvailable).toBe(false);
  });

  it('handles a missing or past reset time without inventing one', () => {
    const acc: RuntimeAccount = {
      ...subscription,
      limits: [
        { kind: 'session', label: 'Session', utilization: 5, resetsAt: null, scopeLabel: null },
        { kind: 'weekly_all', label: 'Weekly', utilization: 5, resetsAt: '2026-09-05T17:34:00.000Z', scopeLabel: null },
      ],
    };
    expect(accountLimits([acc], now)[0]?.windows.map((w) => w.resetsIn)).toEqual([null, 'resetting now']);
  });

  it('clamps a utilisation outside 0..100', () => {
    const acc: RuntimeAccount = { ...subscription, limits: [{ kind: 'session', label: 'Session', utilization: 140, resetsAt: null, scopeLabel: null }] };
    expect(accountLimits([acc], now)[0]?.windows[0]?.percent).toBe(100);
  });

  it('is empty when nothing has been probed', () => {
    expect(accountLimits([], now)).toEqual([]);
    expect(accountLimits(null, now)).toEqual([]);
  });

  it('separates a probe that failed from an account that simply has no windows', () => {
    const failed: RuntimeAccount = {
      ...subscription, billingType: 'unknown', planLabel: null, limitsAvailable: false, limits: [],
      note: 'claude: the get_usage probe returned no control response (exit -1: spawn error)',
    };
    expect(accountLimits([failed], now)[0]).toMatchObject({ probeFailed: true, note: failed.note });
    expect(accountLimits([{ ...subscription, limitsAvailable: false, limits: [], note: 'no windows' }], now)[0]?.probeFailed).toBe(false);
  });
});

describe('mixedBillingNote', () => {
  it('explains the cost figure only when the window really mixes billing types', () => {
    expect(mixedBillingNote({ subscription: 10, metered: 1, unknown: 0 })).toBe(MIXED_BILLING_NOTE);
    expect(mixedBillingNote({ subscription: 10, metered: 0, unknown: 1 })).toBe(MIXED_BILLING_NOTE);
  });

  it('says nothing when there is nothing to explain', () => {
    expect(mixedBillingNote({ subscription: 10, metered: 0, unknown: 0 })).toBeNull();
    expect(mixedBillingNote({ subscription: 0, metered: 10, unknown: 4 })).toBeNull();
    expect(mixedBillingNote(undefined)).toBeNull();
  });
});

describe('runtimeLimitStrip', () => {
  const now = new Date('2026-09-05T17:35:00.000Z');
  const subscription: RuntimeAccount = {
    workspaceId: 'ws', runtimeId: 'claude', billingType: 'subscription_included', planLabel: 'max',
    limitsAvailable: true,
    limits: [
      { kind: 'weekly_all', label: 'Weekly', utilization: 23, resetsAt: '2026-09-10T01:59:59.000Z', scopeLabel: null },
      { kind: 'session', label: 'Session', utilization: 33, resetsAt: '2026-09-05T19:45:00.000Z', scopeLabel: null },
    ],
    note: null, capturedAt: '2026-09-05T17:33:00.000Z',
  };

  it('meters the session window with a bare countdown, whatever order the runtime lists windows in', () => {
    expect(runtimeLimitStrip([subscription], 'claude', now)).toEqual({
      runtimeId: 'claude',
      plan: 'max',
      meter: { label: 'Session', percent: 33, resetsIn: '2h 10m', tone: 'ok' },
      reason: null,
      note: null,
      age: '2m ago',
      capturedAt: '2026-09-05T17:33:00.000Z',
    });
  });

  it('warns past 80 % and calls it over past 95 %', () => {
    const at = (utilization: number): string | undefined =>
      runtimeLimitStrip([{ ...subscription, limits: [{ kind: 'session', label: 'Session', utilization, resetsAt: null, scopeLabel: null }] }], 'claude', now)?.meter?.tone;
    expect(at(79)).toBe('ok');
    expect(at(80)).toBe('warn');
    expect(at(96)).toBe('over');
  });

  it('falls back to the only window a runtime reports, scope label and all', () => {
    const weeklyOnly: RuntimeAccount = { ...subscription, limits: [subscription.limits[0]!, { kind: 'weekly_scoped', label: 'Weekly', utilization: 12, resetsAt: null, scopeLabel: 'Fable' }] };
    expect(runtimeLimitStrip([weeklyOnly], 'claude', now)?.meter).toEqual({ label: 'Weekly', percent: 23, resetsIn: '4d 8h', tone: 'ok' });
  });

  it('shows nothing at all for a metered account, which has no plan window', () => {
    expect(runtimeLimitStrip([{ ...subscription, billingType: 'metered_api', planLabel: null, limitsAvailable: false, limits: [] }], 'claude', now)).toBeNull();
  });

  it('shows nothing until that runtime has been probed', () => {
    expect(runtimeLimitStrip([subscription], 'codex', now)).toBeNull();
    expect(runtimeLimitStrip([], 'claude', now)).toBeNull();
    expect(runtimeLimitStrip(null, null, now)).toBeNull();
  });

  it('gives one quiet reason, and no zero, when a subscription reports no windows', () => {
    const bare: RuntimeAccount = { ...subscription, limitsAvailable: false, limits: [], note: 'codex: the CLI keeps plan limits in its session rollout file' };
    expect(runtimeLimitStrip([bare], 'claude', now)).toMatchObject({ meter: null, reason: 'Limits unavailable', note: bare.note });
  });

  it('separates a probe that failed from a plan that simply has no windows', () => {
    const failed: RuntimeAccount = { ...subscription, billingType: 'unknown', planLabel: null, limitsAvailable: false, limits: [], note: 'exit -1: spawn error' };
    expect(runtimeLimitStrip([failed], 'claude', now)).toMatchObject({ meter: null, reason: 'Account probe failed', plan: 'unknown' });
  });

  it('counts down to the reset and past it', () => {
    const resetsIn = (at: string): string | null | undefined => runtimeLimitStrip([subscription], 'claude', new Date(at))?.meter?.resetsIn;
    expect(resetsIn('2026-09-05T18:58:00.000Z')).toBe('47m');
    expect(resetsIn('2026-09-05T19:44:30.000Z')).toBe('now');
    expect(resetsIn('2026-09-05T20:00:00.000Z')).toBe('now');
  });
});

describe('resolveModel', () => {
  const models = [{ id: 'opus', contextWindowTokens: 200_000 }, { id: 'claude-opus-5', contextWindowTokens: 200_000 }, { id: 'claude-opus-5-1m', contextWindowTokens: 1_000_000 }];

  it('takes the exact entry before any prefix of it', () => {
    expect(resolveModel(models, 'claude-opus-5')?.contextWindowTokens).toBe(200_000);
    expect(resolveModel(models, 'claude-opus-5-1m')?.contextWindowTokens).toBe(1_000_000);
  });

  it('falls back to the longest entry a reported build id starts with', () => {
    expect(resolveModel(models, 'claude-opus-5-20260115')?.id).toBe('claude-opus-5');
  });

  it('resolves an alias the list also carries', () => {
    expect(resolveModel(models, 'opus')?.id).toBe('opus');
  });

  it('guesses nothing when nothing matches', () => {
    expect(resolveModel(models, 'gpt-5')).toBeNull();
    expect(resolveModel(models, null)).toBeNull();
    expect(resolveModel(null, 'opus')).toBeNull();
  });
});

describe('contextStrip', () => {
  // A realistic turn: eight or so API requests, each re-sending or cache-reading the whole
  // conversation, so the cumulative counts come to 987,790 tokens — the shape of the two conductor
  // runs that made the meter read 100 % (VS-98). The context is one request of it: 82,000.
  const usage = { inputTokens: 320_119, cachedInputTokens: 667_671, outputTokens: 1_022, contextTokens: 82_000 };

  it('reads the context as the last request\u2019s size, not the turn\u2019s totals', () => {
    expect(contextTokens(usage)).toBe(82_000);
    expect(contextTokens(null)).toBe(0);
  });

  it('measures the window and the distance to compaction', () => {
    expect(contextStrip({ usage, contextWindowTokens: 200_000, compactionAt: 0.92, hasRun: true })).toEqual({
      tokens: 82_000,
      tokensLabel: '82k',
      windowLabel: '200k',
      meter: { percent: 41, toCompaction: 45, tone: 'ok' },
      reason: null,
    });
  });

  it('cannot exceed 100 % for a turn whose totals dwarf the window', () => {
    // The regression: 987,790 cumulative tokens against a 200k window is 494 %, clamped to 100 %.
    // Measured one request at a time it is 41 %, and no arrangement of the totals can reach the top.
    const v = contextStrip({ usage, contextWindowTokens: 200_000, compactionAt: 0.92, hasRun: true });
    expect(v?.meter?.percent).toBe(41);
    expect(v?.meter?.percent).toBeLessThan(100);
    expect(v?.tokens).toBeLessThan(usage.inputTokens + usage.cachedInputTokens);
  });

  it('measures against a larger window without a special case', () => {
    expect(contextStrip({ usage, contextWindowTokens: 1_000_000, compactionAt: 0.92, hasRun: true })?.meter)
      .toEqual({ percent: 8, toCompaction: 9, tone: 'ok' });
  });

  it('takes its tone from the distance to compaction, not from the raw window', () => {
    const at = (tokens: number): string | undefined =>
      contextStrip({ usage: { contextTokens: tokens }, contextWindowTokens: 200_000, compactionAt: 0.92, hasRun: true })?.meter?.tone;
    // 147.2k of 184k is 80 % of the way to compaction but only 74 % of the window.
    expect(at(147_200)).toBe('warn');
    expect(at(146_000)).toBe('ok');
    expect(at(175_000)).toBe('over');
  });

  it('falls back to the window when the runtime does not compact', () => {
    const v = contextStrip({ usage, contextWindowTokens: 200_000, hasRun: true });
    expect(v?.meter).toEqual({ percent: 41, toCompaction: null, tone: 'ok' });
  });

  it('shows a context that has outgrown the numbers we were given as anomalous, not clamped (VS-129)', () => {
    // 500k against a declared 200k window is evidence the declared window is wrong, not a context
    // that has simply filled it — the old behaviour clamped both figures to 100, indistinguishable
    // from a context that had genuinely just reached the top.
    expect(contextStrip({ usage: { contextTokens: 500_000 }, contextWindowTokens: 200_000, compactionAt: 0.92, hasRun: true })?.meter)
      .toEqual({ percent: 250, toCompaction: 272, tone: 'over' });
  });

  it('says nothing at all before the conductor has finished a turn', () => {
    expect(contextStrip({ usage: null, contextWindowTokens: 200_000, compactionAt: 0.92, hasRun: false })).toBeNull();
  });

  it('gives one quiet reason, and no percentage, when the window is unknown', () => {
    expect(contextStrip({ usage, contextWindowTokens: null, compactionAt: 0.92, hasRun: true }))
      .toEqual({ tokens: 82_000, tokensLabel: '82k', windowLabel: '\u2014', meter: null, reason: 'Context window unknown' });
    expect(contextStrip({ usage, contextWindowTokens: 0, hasRun: true })?.reason).toBe('Context window unknown');
  });

  it('gives one quiet reason, and no percentage, when the turn reported no tokens', () => {
    expect(contextStrip({ usage: null, contextWindowTokens: 200_000, compactionAt: 0.92, hasRun: true }))
      .toMatchObject({ tokens: 0, meter: null, reason: 'Context size unreported' });
    expect(contextStrip({ usage: { contextTokens: 0 }, contextWindowTokens: 200_000, hasRun: true })?.reason).toBe('Context size unreported');
  });

  it('reports nothing rather than a total for a runtime that cannot measure one request', () => {
    // opencode, gemini and codex report only what the whole turn consumed. Measuring that against
    // the window is what produced the wrong number, so it is not measured at all.
    const cumulativeOnly: { inputTokens: number; cachedInputTokens: number; outputTokens: number; contextTokens?: number } =
      { inputTokens: 320_119, cachedInputTokens: 667_671, outputTokens: 1_022 };
    expect(contextStrip({ usage: cumulativeOnly, contextWindowTokens: 200_000, compactionAt: 0.92, hasRun: true }))
      .toMatchObject({ tokens: 0, meter: null, reason: 'Context size unreported' });
  });
});

describe('firstRequest (VS-462)', () => {
  it('says nothing when the runtime reported no first request', () => {
    expect(firstRequest(null)).toBeNull();
    expect(firstRequest(undefined)).toBeNull();
    expect(firstRequest({})).toBeNull();
  });

  it('splits the first request into fresh and cached, and labels it', () => {
    expect(firstRequest({ firstRequest: { freshTokens: 1_664, cachedTokens: 110_080 } })).toEqual({
      freshTokens: 1_664,
      cachedTokens: 110_080,
      label: '1.7k fresh · 110k cached',
      missed: false,
    });
  });

  it('flags a first request that re-sent more than the threshold uncached', () => {
    expect(firstRequest({ firstRequest: { freshTokens: 74_076, cachedTokens: 1_664 } })?.missed).toBe(true);
    // The threshold itself counts as a miss; one below it does not.
    expect(firstRequest({ firstRequest: { freshTokens: FIRST_REQUEST_MISS_THRESHOLD, cachedTokens: 0 } })?.missed).toBe(true);
    expect(firstRequest({ firstRequest: { freshTokens: FIRST_REQUEST_MISS_THRESHOLD - 1, cachedTokens: 0 } })?.missed).toBe(false);
  });
});
