import { describe, expect, it } from 'vitest';
import { OcError } from '@weave-ai/shared';
import { nextAfter, parseSchedule, zonedLocalToUtc } from './schedule.js';

describe('parseSchedule (VS-220)', () => {
  it('rejects an unknown timezone', () => {
    expect(() => parseSchedule({ kind: 'schedule', timezone: 'Mars/Olympus', daily: { hour: 7, minute: 0 } })).toThrow(OcError);
    expect(() => parseSchedule({ kind: 'schedule', timezone: 'Mars/Olympus', daily: { hour: 7, minute: 0 } })).toThrow(/timezone/);
  });

  it('rejects everyMinutes below 15', () => {
    expect(() => parseSchedule({ kind: 'schedule', timezone: 'UTC', everyMinutes: 14 })).toThrow(/everyMinutes/);
    expect(() => parseSchedule({ kind: 'schedule', timezone: 'UTC', everyMinutes: 14.5 })).toThrow(/everyMinutes/);
  });

  it('rejects webhook and cron triggers', () => {
    expect(() => parseSchedule({ kind: 'webhook' })).toThrow(/webhook/);
    expect(() => parseSchedule({ kind: 'schedule', timezone: 'UTC', cron: '0 7 * * *' })).toThrow(/cron/);
  });

  it('accepts a daily clock and an interval of 15 or more', () => {
    expect(parseSchedule({ kind: 'schedule', timezone: 'Europe/Copenhagen', daily: { hour: 7, minute: 0 } })).toEqual({
      kind: 'schedule', timezone: 'Europe/Copenhagen', daily: { hour: 7, minute: 0 },
    });
    expect(parseSchedule({ kind: 'schedule', timezone: 'UTC', everyMinutes: 15 })).toEqual({
      kind: 'schedule', timezone: 'UTC', everyMinutes: 15,
    });
    expect(parseSchedule({ kind: 'schedule', timezone: 'UTC', everyMinutes: 60 })).toEqual({
      kind: 'schedule', timezone: 'UTC', everyMinutes: 60,
    });
  });
});

describe('nextAfter (VS-220)', () => {
  const dailyCph = parseSchedule({ kind: 'schedule', timezone: 'Europe/Copenhagen', daily: { hour: 7, minute: 0 } });
  const dailyUtc = parseSchedule({ kind: 'schedule', timezone: 'UTC', daily: { hour: 7, minute: 0 } });

  it('daily 07:00 Europe/Copenhagen vs UTC around a DST spring-forward', () => {
    // 2026-03-29 02:00 → 03:00 in Europe/Copenhagen. 07:00 still exists both days.
    // 28 Mar is CET (UTC+1); 29 Mar after the jump is CEST (UTC+2).
    const beforeSevenCet = '2026-03-28T05:59:00.000Z'; // 06:59 CET
    expect(nextAfter(dailyCph, beforeSevenCet)).toBe('2026-03-28T06:00:00.000Z'); // 07:00 CET
    const afterSevenCet = '2026-03-28T07:00:00.000Z'; // 08:00 CET
    expect(nextAfter(dailyCph, afterSevenCet)).toBe('2026-03-29T05:00:00.000Z'); // 07:00 CEST
    expect(nextAfter(dailyUtc, '2026-03-28T06:59:00.000Z')).toBe('2026-03-28T07:00:00.000Z');
    expect(nextAfter(dailyUtc, '2026-03-28T07:00:00.000Z')).toBe('2026-03-29T07:00:00.000Z');
  });

  it('interval 60 minutes from a known instant', () => {
    const hourly = parseSchedule({ kind: 'schedule', timezone: 'UTC', everyMinutes: 60 });
    expect(nextAfter(hourly, '2026-01-15T10:00:00.000Z')).toBe('2026-01-15T11:00:00.000Z');
  });

  it('is strictly after fromInstant, including an exact hit', () => {
    expect(nextAfter(dailyUtc, '2026-01-15T07:00:00.000Z')).toBe('2026-01-16T07:00:00.000Z');
  });

  it('maps 07:00 Copenhagen on a winter day to 06:00 UTC', () => {
    const instant = zonedLocalToUtc('Europe/Copenhagen', 2026, 1, 15, 7, 0);
    expect(instant.toISOString()).toBe('2026-01-15T06:00:00.000Z');
  });
});
