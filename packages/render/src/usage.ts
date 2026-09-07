/**
 * Usage view models: totals with a window-over-window delta and a cost-provenance label, and the
 * plan-limit block a subscription account replaces that cost with (PLAN §16.3).
 */
import type { CostStatus, RuntimeAccount, UsageBillingMix } from '@agent-conductor/shared';
import { formatCents, formatCost, formatCountdown, formatDelta, formatRelative, formatReportedShare, formatTokens } from './format.js';
import type { AccountLimitsView, ContextStripView, RuntimeLimitStripView, UsageTotalsView } from './types.js';

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

/** Amber past 80 %, red past 95 % — the thresholds the plan-limit bars and the budget meter share. */
function limitTone(percent: number): 'ok' | 'warn' | 'over' {
  return percent >= 95 ? 'over' : percent >= 80 ? 'warn' : 'ok';
}

/**
 * The plan meter for one runtime, sized for a page header: the session window with a live
 * countdown to its reset, or the one reason there is nothing to meter.
 *
 * Null when there is nothing a header should say at all — no snapshot for that runtime, or an
 * account billed per token, which has no plan window to be a fraction of. A subscription whose
 * limits the runtime could not report, and an account the probe could not describe, both come back
 * with `reason` and no `meter`: a quiet line beats a bar drawn at zero.
 */
export function runtimeLimitStrip(
  accounts: RuntimeAccount[] | null | undefined,
  runtimeId: string | null | undefined,
  now: Date = new Date(),
): RuntimeLimitStripView | null {
  if (!runtimeId) return null;
  const account = (accounts ?? []).find((a) => a.runtimeId === runtimeId);
  if (!account || account.billingType === 'metered_api') return null;

  const base = {
    runtimeId: account.runtimeId,
    plan: account.planLabel ?? (account.billingType === 'subscription_included' ? 'subscription' : 'unknown'),
    note: account.note,
    age: formatRelative(account.capturedAt, now),
    capturedAt: account.capturedAt,
  };

  // The session window is the one the header is about; a runtime that reports only a weekly window
  // shows that rather than nothing, since it is still the limit the human is spending against.
  const window = account.limitsAvailable ? account.limits.find((w) => w.kind === 'session') ?? account.limits[0] : undefined;
  if (!window) {
    return {
      ...base,
      meter: null,
      reason: account.billingType === 'unknown' ? 'Account probe failed' : 'Limits unavailable',
    };
  }
  const percent = Math.max(0, Math.min(100, Math.round(window.utilization)));
  return {
    ...base,
    meter: {
      label: windowLabel(window.label, window.scopeLabel),
      percent,
      resetsIn: formatCountdown(window.resetsAt, now),
      tone: limitTone(percent),
    },
    reason: null,
  };
}

/**
 * Which entry of a runtime's model list a reported model id is. Exact first, then the longest entry
 * the id starts with: a CLI reports a dated build (`claude-opus-5-20260115`) where the list carries
 * the family (`claude-opus-5`), and an alias (`opus`) where the list carries the alias too. Null
 * rather than a guess when nothing matches — the caller then says the window is unknown.
 */
export function resolveModel<T extends { id: string }>(models: T[] | null | undefined, modelId: string | null | undefined): T | null {
  if (!modelId) return null;
  const list = models ?? [];
  const exact = list.find((m) => m.id === modelId);
  if (exact) return exact;
  const prefixed = list.filter((m) => m.id.length > 0 && modelId.startsWith(m.id)).sort((a, b) => b.id.length - a.id.length);
  return prefixed[0] ?? null;
}

/** The live context size of a resumed session: what the last turn sent, plus what it read from cache. */
export function contextTokens(usage: { inputTokens?: number | null; cachedInputTokens?: number | null } | null | undefined): number {
  return n(usage?.inputTokens) + n(usage?.cachedInputTokens);
}

/**
 * How full the conductor's context is: the last turn's context size as a fraction of the model's
 * window, and how far that is towards the point the runtime compacts at.
 *
 * The turn's own `inputTokens + cachedInputTokens` is the context size because the session is
 * resumed — everything the conversation holds is re-sent or read back from cache on every turn.
 *
 * Null when there is no finished turn to measure, which is not a failure and needs no line. A turn
 * that reported nothing usable, and a model whose window we cannot state, both come back with a
 * `reason` and no meter rather than a percentage of a number we invented.
 */
export function contextStrip(input: {
  usage: { inputTokens?: number | null; cachedInputTokens?: number | null } | null | undefined;
  /** The model's own context window, from the runtime's model list. */
  contextWindowTokens: number | null | undefined;
  /** The runtime's compaction point as a fraction of the window, from its capabilities. */
  compactionAt?: number | null;
  /** False before the conductor has ever finished a turn. */
  hasRun: boolean;
}): ContextStripView | null {
  if (!input.hasRun) return null;
  const tokens = contextTokens(input.usage);
  const window = input.contextWindowTokens;
  const bare = { tokens, tokensLabel: formatTokens(tokens), windowLabel: window ? formatTokens(window) : '—', meter: null };
  if (tokens <= 0) return { ...bare, reason: 'Context size unreported' };
  if (!window || !Number.isFinite(window) || window <= 0) return { ...bare, reason: 'Context window unknown' };

  const percent = Math.max(0, Math.min(100, Math.round((tokens / window) * 100)));
  const compactionTokens = input.compactionAt && input.compactionAt > 0 ? window * input.compactionAt : null;
  const toCompaction = compactionTokens ? Math.max(0, Math.min(100, Math.round((tokens / compactionTokens) * 100))) : null;
  return {
    ...bare,
    meter: { percent, toCompaction, tone: limitTone(toCompaction ?? percent) },
    reason: null,
  };
}
