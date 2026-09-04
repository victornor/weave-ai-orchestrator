import { describe, expect, it } from 'vitest';
import { parseResetTime } from './engine.js';

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
});
