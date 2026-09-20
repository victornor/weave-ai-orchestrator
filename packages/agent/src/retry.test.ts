import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { backoffMs, MAX_WAIT_MS, parseRetryAfter, planRetry } from './retry.js';
import type { AgentError } from './types.js';

const transient: AgentError = { code: 'upstream_error', family: 'transient_upstream', message: 'x' };

describe('parseRetryAfter', () => {
  it('reads seconds, fractional seconds and an HTTP date', () => {
    expect(parseRetryAfter('7')).toBe(7000);
    expect(parseRetryAfter('1.5')).toBe(1500);
    expect(parseRetryAfter('Sun, 20 Sep 2026 03:00:10 GMT', Date.parse('Sun, 20 Sep 2026 03:00:00 GMT'))).toBe(10_000);
  });
  it('is zero for a date in the past and undefined for junk', () => {
    expect(parseRetryAfter('Sun, 20 Sep 2026 02:00:00 GMT', Date.parse('Sun, 20 Sep 2026 03:00:00 GMT'))).toBe(0);
    expect(parseRetryAfter('soon')).toBeUndefined();
    expect(parseRetryAfter(null)).toBeUndefined();
  });
});

describe('backoff and the plan', () => {
  it('doubles from two seconds, caps at a minute and adds up to a quarter in jitter', () => {
    expect([0, 1, 2, 3].map((n) => backoffMs(n, () => 0))).toEqual([2000, 4000, 8000, 16_000]);
    expect(backoffMs(20, () => 0)).toBe(60_000);
    expect(backoffMs(0, () => 1)).toBe(2500);
  });
  it('retries a transient failure up to its cap, then stops', () => {
    const r = (): number => 0;
    expect(planRetry(transient, 0, { random: r })).toEqual({ retry: true, delayMs: 2000 });
    expect(planRetry(transient, 3, { random: r })).toEqual({ retry: true, delayMs: 16_000 });
    expect(planRetry(transient, 4)).toEqual({ retry: false });
    expect(planRetry({ ...transient, maxRetries: 1 }, 1)).toEqual({ retry: false });
  });
  it('waits at least Retry-After, and surfaces instead of waiting past two minutes', () => {
    expect(planRetry({ ...transient, retryAfterMs: 30_000 }, 0, { random: () => 0 })).toEqual({ retry: true, delayMs: 30_000 });
    expect(planRetry({ ...transient, retryAfterMs: MAX_WAIT_MS + 1 }, 0)).toEqual({ retry: false });
  });
  it('never sleeps past the run deadline', () => {
    expect(planRetry(transient, 0, { random: () => 0, nowMs: 1000, deadlineAt: 2500 })).toEqual({ retry: false });
    expect(planRetry(transient, 0, { random: () => 0, nowMs: 1000, deadlineAt: 10_000 })).toEqual({ retry: true, delayMs: 2000 });
  });
  it('does not retry quota, auth or tooling', () => {
    for (const family of ['provider_quota', 'auth', 'tooling', 'resource', 'model_refusal', 'unknown'] as const) expect(planRetry({ code: 'x', family, message: '' }, 0)).toEqual({ retry: false });
  });
});

describe('a 429 storm on the ladder under fake timers', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());
  it('spends the whole ladder in the summed backoff and no more', async () => {
    const started = Date.now();
    let attempt = 0;
    const run = (async (): Promise<number> => {
      for (;;) {
        const plan = planRetry({ ...transient, code: 'rate_limited' }, attempt, { random: () => 0 });
        if (!plan.retry) return attempt;
        await new Promise((r) => setTimeout(r, plan.delayMs));
        attempt++;
      }
    })();
    await vi.advanceTimersByTimeAsync(2000 + 4000 + 8000 + 16_000);
    expect(await run).toBe(4);
    expect(Date.now() - started).toBe(30_000);
  });
});
