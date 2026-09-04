/** Usage view models: totals with a window-over-window delta and a cost-provenance label (PLAN §16.3). */
import type { CostStatus } from '@agent-conductor/shared';
import { formatCents, formatCost, formatDelta, formatReportedShare, formatTokens } from './format.js';
import type { UsageTotalsView } from './types.js';

export interface UsagePoint {
  bucket?: string;
  tokensIn?: number;
  tokensOut?: number;
  tokensCached?: number;
  runs?: number;
  durationMs?: number;
  costCents?: number;
  costReportedCents?: number;
}

export interface UsageSeries {
  range?: { start: string; end: string; window: string; grain: string; prevStart: string; prevEnd: string };
  points?: UsagePoint[];
  total?: UsagePoint;
  previous?: UsagePoint;
  costReportedShare?: number;
}

const n = (v: number | undefined | null): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

export function totalTokens(p: UsagePoint | null | undefined): number {
  if (!p) return 0;
  return n(p.tokensIn) + n(p.tokensOut);
}

/** `reported` only when every cent in the window came back from the provider. */
export function costStatusFor(p: UsagePoint | null | undefined): CostStatus {
  const cost = n(p?.costCents);
  if (cost === 0) return 'unpriced';
  const reported = n(p?.costReportedCents);
  return reported >= cost ? 'reported' : 'estimated';
}

export function usageTotals(series: UsageSeries | null | undefined): UsageTotalsView {
  const total = series?.total ?? {};
  const previous = series?.previous ?? {};
  const status = costStatusFor(total);
  const share = series?.costReportedShare ?? (n(total.costCents) > 0 ? n(total.costReportedCents) / n(total.costCents) : null);
  return {
    tokens: formatTokens(totalTokens(total)),
    tokensIn: formatTokens(n(total.tokensIn)),
    tokensOut: formatTokens(n(total.tokensOut)),
    tokensCached: formatTokens(n(total.tokensCached)),
    cost: formatCost(n(total.costCents), status),
    costStatus: status,
    reportedShare: formatReportedShare(share),
    runs: n(total.runs),
    tokensDelta: formatDelta(totalTokens(total), totalTokens(previous)),
    costDelta: formatDelta(n(total.costCents), n(previous.costCents)),
  };
}

export interface UsageRow { bucket: string; tokens: string; tokensIn: string; tokensOut: string; cost: string; runs: number }

export function usageRows(series: UsageSeries | null | undefined): UsageRow[] {
  const points = Array.isArray(series?.points) ? series!.points! : [];
  return points.map((p) => ({
    bucket: p.bucket ?? '',
    tokens: formatTokens(totalTokens(p)),
    tokensIn: formatTokens(n(p.tokensIn)),
    tokensOut: formatTokens(n(p.tokensOut)),
    cost: formatCents(n(p.costCents)),
    runs: n(p.runs),
  }));
}

/**
 * Budget meter line (design contract §4): `web · project KB · 7.2k / 12k tok · curated 2d ago`.
 * Amber at 80 % or when curation is pending.
 */
export function budgetMeter(input: { label: string; tokenEstimate: number; budgetTokens: number; lastCuratedAt?: string | null; curationPending?: boolean }): { text: string; pct: number; tone: 'ok' | 'warn' | 'over' } {
  const pct = input.budgetTokens > 0 ? input.tokenEstimate / input.budgetTokens : 0;
  const tone: 'ok' | 'warn' | 'over' = pct >= 1 ? 'over' : pct >= 0.8 || input.curationPending === true ? 'warn' : 'ok';
  return {
    text: `${input.label} · ${formatTokens(input.tokenEstimate)} / ${formatTokens(input.budgetTokens)} tok`,
    pct: Math.round(pct * 100) / 100,
    tone,
  };
}
