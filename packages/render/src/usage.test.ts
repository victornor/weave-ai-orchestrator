import { describe, expect, it } from 'vitest';
import type { RuntimeAccount } from '@agent-conductor/shared';
import { accountLimits, budgetMeter, costStatusFor, MIXED_BILLING_NOTE, mixedBillingNote, showCost, usageRows, usageTotals } from './usage.js';

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
