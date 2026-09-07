/**
 * Usage view models: totals with a window-over-window delta and a cost-provenance label, and the
 * plan-limit block a subscription account replaces that cost with (PLAN §16.3).
 */
import type { CostStatus, RuntimeAccount, UsageBillingMix } from '@agent-conductor/shared';
import { formatCents, formatCost, formatDelta, formatRelative, formatReportedShare, formatTokens } from './format.js';
import type { AccountLimitsView, UsageTotalsView } from './types.js';

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
  billingMix?: UsageBillingMix;
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

/**
 * Should the dollar figure be shown for this window? Only when something in it was actually
 * billed per token. `unknown` counts against hiding: rows recorded before a runtime had an
 * account snapshot may well have been metered, and the safe failure is showing a cost that does
 * not matter rather than hiding one that does.
 */
export function showCost(mix: UsageBillingMix | null | undefined): boolean {
  if (!mix) return true;
  if (n(mix.metered) > 0 || n(mix.unknown) > 0) return true;
  return n(mix.subscription) === 0;
}

/**
 * Why a window that contains subscription usage still shows a dollar figure: something in it was
 * metered, or was recorded before the account was classified and is therefore not known to be
 * covered. Null when the window is not mixed and the caller has nothing to explain.
 */
export const MIXED_BILLING_NOTE = 'This window mixes subscription usage with metered or unclassified usage, so cost is still shown.';

export function mixedBillingNote(mix: UsageBillingMix | null | undefined): string | null {
  if (!mix) return null;
  const other = n(mix.metered) + n(mix.unknown);
  return n(mix.subscription) > 0 && other > 0 ? MIXED_BILLING_NOTE : null;
}

/** `resets in 34m` · `resets in 4d` · null when the runtime reported no reset time. */
function resetIn(resetsAt: string | null, now: Date): string | null {
  if (!resetsAt) return null;
  const t = Date.parse(resetsAt);
  if (!Number.isFinite(t)) return null;
  const min = Math.round((t - now.getTime()) / 60_000);
  if (min <= 0) return 'resetting now';
  if (min < 60) return `resets in ${min}m`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `resets in ${hr}h`;
  return `resets in ${Math.round(hr / 24)}d`;
}

/** A window's label, with the model it is scoped to when it has one: `Weekly · Fable`. */
function windowLabel(label: string, scopeLabel: string | null): string {
  return scopeLabel ? `${label} · ${scopeLabel}` : label;
}

/**
 * The plan-limit block for one runtime account: what the web usage page and `conductor usage`
 * both render. An account with no windows carries `note` and an empty `windows` — the caller
 * says the limits are unavailable rather than drawing a bar at zero.
 */
export function accountLimits(accounts: RuntimeAccount[] | null | undefined, now: Date = new Date()): AccountLimitsView[] {
  return (accounts ?? []).map((a) => ({
    runtimeId: a.runtimeId,
    billingType: a.billingType,
    plan: a.planLabel ?? (a.billingType === 'subscription_included' ? 'subscription' : a.billingType === 'metered_api' ? 'API key' : 'unknown'),
    limitsAvailable: a.limitsAvailable && a.limits.length > 0,
    probeFailed: a.billingType === 'unknown',
    windows: a.limitsAvailable
      ? a.limits.map((w) => ({
        key: `${w.kind}:${w.scopeLabel ?? ''}`,
        label: windowLabel(w.label, w.scopeLabel),
        percent: Math.max(0, Math.min(100, Math.round(w.utilization))),
        resetsIn: resetIn(w.resetsAt, now),
      }))
      : [],
    note: a.note,
    age: formatRelative(a.capturedAt, now),
  }));
}
