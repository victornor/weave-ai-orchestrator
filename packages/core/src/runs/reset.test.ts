import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseResetTime } from './engine.js';

const captures = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const readCapture = (name: string): string => readFileSync(join(captures, name), 'utf8').trim();

describe('parseResetTime', () => {
  const now = new Date('2026-09-05T10:00:00Z');
  it('reads relative resets', () => {
    expect(parseResetTime('Usage limit reached. Try again in 2 hours.', now)?.toISOString()).toBe('2026-09-05T12:00:00.000Z');
    expect(parseResetTime('rate limited, resets in 45 minutes', now)?.toISOString()).toBe('2026-09-05T10:45:00.000Z');
  });
  it('reads clock resets and rolls to tomorrow when past', () => {
    const at = parseResetTime("You've hit your limit · resets at 3pm", now);
    expect(at).not.toBeNull();
    expect(at!.getHours()).toBe(15);
    expect(at!.getTime()).toBeGreaterThan(now.getTime());
  });
  it('returns null when nothing is stated', () => {
    expect(parseResetTime('exit 1', now)).toBeNull();
  });

  it('reads the VS-234 OpenCode capture at the failure instant, not as UTC (VS-238)', () => {
    const failureNow = new Date('2026-09-11T17:00:12.000Z');
    const at = parseResetTime(readCapture('vs-234-opencode.txt'), failureNow);
    expect(at?.toISOString()).toBe('2026-09-11T17:54:35.000Z');
    expect(at?.toISOString()).not.toBe('2026-09-12T01:54:35.000Z');
  });

  it('does not take hour 20 from a year in a naive reset clock (VS-238)', () => {
    const failureNow = new Date('2026-09-11T17:00:12.000Z');
    const at = parseResetTime('limit resets at 2026-09-12 01:54:35', failureNow);
    expect(at?.toISOString()).not.toBeNull();
    expect(at!.getUTCHours()).not.toBe(20);
    expect(at?.toISOString()).toBe('2026-09-11T17:54:35.000Z');
  });

  it('parses Claude within-24h Ou as a clock (VS-238)', () => {
    const at = parseResetTime('until your limit resets at 3:54pm', now);
    expect(at).not.toBeNull();
    expect(at!.getHours()).toBe(15);
    expect(at!.getMinutes()).toBe(54);
  });

  it('returns null for captured spend-cap and usage-limit strings with no timestamp (VS-238)', () => {
    expect(parseResetTime(readCapture('claude-monthly-spend-limit.txt'), now)).toBeNull();
    expect(parseResetTime(readCapture('codex-youve-hit-your-usage-limit.txt'), now)).toBeNull();
  });

  it('returns null for a timestamp 30 days out or already past (VS-238)', () => {
    expect(parseResetTime('Your limit will reset at 2026-10-12 01:54:35', now)).toBeNull();
    expect(parseResetTime('Your limit will reset at 2026-09-04 01:54:35', now)).toBeNull();
  });

  it('keeps a zoned ISO timestamp inside the bound and does not re-zone it (VS-238)', () => {
    const at = parseResetTime('resets_at: 2026-09-05T18:09:59.639941+00:00', now);
    expect(at?.toISOString()).toBe('2026-09-05T18:09:59.639Z');
  });
});
