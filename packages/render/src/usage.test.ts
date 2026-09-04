import { describe, expect, it } from 'vitest';
import { budgetMeter, costStatusFor, usageRows, usageTotals } from './usage.js';

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
