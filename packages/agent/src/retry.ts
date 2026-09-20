import { DEFAULT_MAX_RETRIES, isRetryable } from './errors.js';
import type { AgentError } from './types.js';

export const BACKOFF_BASE_MS = 2000;
export const BACKOFF_CAP_MS = 60_000;
/** A `Retry-After` longer than this is not waited on: the failure surfaces with `retryAfterMs` and the engine's own ladder decides. */
export const MAX_WAIT_MS = 120_000;

/** `Retry-After` as delta-seconds or an HTTP date; anything else is ignored. */
export function parseRetryAfter(v: string | null | undefined, nowMs: number = Date.now()): number | undefined {
  if (!v) return undefined;
  const t = v.trim();
  if (/^\d+(\.\d+)?$/.test(t)) return Math.max(0, Math.round(Number(t) * 1000));
  const at = Date.parse(t);
  return Number.isNaN(at) ? undefined : Math.max(0, at - nowMs);
}

/** Exponential backoff from the base, capped, with 0 to 25 % jitter so a herd of runs on one key spreads out. */
export function backoffMs(attempt: number, random: () => number = Math.random): number {
  return Math.round(Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * 2 ** attempt) * (1 + random() * 0.25));
}

export type RetryPlan = { retry: true; delayMs: number } | { retry: false };

/**
 * What to do after failed attempt number `attempt` (0-based). No retry when the failure is not
 * transient, its cap is spent, the provider asks for a wait too long to sit through, or the wait
 * would run past the run's deadline.
 */
export function planRetry(err: AgentError, attempt: number, o: { deadlineAt?: number; nowMs?: number; random?: () => number } = {}): RetryPlan {
  if (!isRetryable(err)) return { retry: false };
  if (attempt >= (err.maxRetries ?? DEFAULT_MAX_RETRIES)) return { retry: false };
  if (err.retryAfterMs !== undefined && err.retryAfterMs > MAX_WAIT_MS) return { retry: false };
  const delayMs = Math.max(err.retryAfterMs ?? 0, backoffMs(attempt, o.random));
  if (o.deadlineAt !== undefined && (o.nowMs ?? Date.now()) + delayMs >= o.deadlineAt) return { retry: false };
  return { retry: true, delayMs };
}
