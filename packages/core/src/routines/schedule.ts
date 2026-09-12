/**
 * Pure schedule math for routines (VS-220). Daily fires are wall-clock in an IANA zone
 * (DST-aware); interval fires are `fromInstant + N minutes`.
 */
import { OcError, ROUTINE_MIN_INTERVAL_MINUTES, type RoutineTrigger } from '@weave-ai/shared';

export function hostTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

export function assertKnownTimezone(tz: string): string {
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: tz });
    return tz;
  } catch {
    throw new OcError('validation', `not a known timezone: ${tz}`);
  }
}

interface ZoneParts { year: number; month: number; day: number; hour: number; minute: number; second: number }

function partsInZone(date: Date, timeZone: string): ZoneParts {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const map: Record<string, string> = {};
  for (const p of dtf.formatToParts(date)) if (p.type !== 'literal') map[p.type] = p.value;
  return {
    year: Number(map['year']), month: Number(map['month']), day: Number(map['day']),
    hour: Number(map['hour']), minute: Number(map['minute']), second: Number(map['second']),
  };
}

function tzOffsetMs(date: Date, timeZone: string): number {
  const p = partsInZone(date, timeZone);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - date.getTime();
}

/** Instant at which `timeZone` shows `year-month-day hour:minute`. If that local time is skipped by DST, the next calendar day at the same clock is used. */
export function zonedLocalToUtc(timeZone: string, year: number, month: number, day: number, hour: number, minute: number): Date {
  const guess = new Date(Date.UTC(year, month - 1, day, hour, minute, 0));
  const instant = new Date(guess.getTime() - tzOffsetMs(guess, timeZone));
  const refined = new Date(guess.getTime() - tzOffsetMs(instant, timeZone));
  const check = partsInZone(refined, timeZone);
  if (check.hour !== hour || check.minute !== minute) {
    const next = new Date(Date.UTC(year, month - 1, day + 1));
    return zonedLocalToUtc(timeZone, next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate(), hour, minute);
  }
  return refined;
}

export function parseSchedule(raw: unknown): RoutineTrigger {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new OcError('validation', 'trigger must be an object');
  }
  const o = raw as Record<string, unknown>;
  if (o['kind'] === 'webhook') throw new OcError('validation', 'webhook triggers are not supported');
  if (typeof o['cron'] === 'string' || o['kind'] === 'cron') throw new OcError('validation', 'cron expressions are not supported');
  if (o['kind'] !== undefined && o['kind'] !== 'schedule') {
    throw new OcError('validation', `unknown trigger kind: ${String(o['kind'])}`);
  }
  const timezone = assertKnownTimezone(
    typeof o['timezone'] === 'string' && o['timezone'].trim() ? o['timezone'].trim() : hostTimezone(),
  );
  if (o['daily'] && typeof o['daily'] === 'object' && !Array.isArray(o['daily'])) {
    const d = o['daily'] as Record<string, unknown>;
    const hour = Number(d['hour']);
    const minute = Number(d['minute']);
    if (!Number.isInteger(hour) || hour < 0 || hour > 23) throw new OcError('validation', 'daily.hour must be an integer 0-23');
    if (!Number.isInteger(minute) || minute < 0 || minute > 59) throw new OcError('validation', 'daily.minute must be an integer 0-59');
    if (o['everyMinutes'] !== undefined) throw new OcError('validation', 'daily and everyMinutes cannot both be set');
    return { kind: 'schedule', timezone, daily: { hour, minute } };
  }
  if (o['everyMinutes'] !== undefined) {
    const n = Number(o['everyMinutes']);
    if (!Number.isInteger(n) || n < ROUTINE_MIN_INTERVAL_MINUTES) {
      throw new OcError('validation', `everyMinutes must be an integer >= ${ROUTINE_MIN_INTERVAL_MINUTES}`);
    }
    return { kind: 'schedule', timezone, everyMinutes: n };
  }
  throw new OcError('validation', 'trigger needs daily {hour, minute} or everyMinutes');
}

/** First occurrence strictly after `fromInstant`. */
export function nextAfter(schedule: RoutineTrigger, fromInstant: Date | string): string {
  const from = typeof fromInstant === 'string' ? new Date(fromInstant) : fromInstant;
  if (Number.isNaN(from.getTime())) throw new OcError('validation', 'fromInstant is not a valid time');
  if ('everyMinutes' in schedule) {
    return new Date(from.getTime() + schedule.everyMinutes * 60_000).toISOString();
  }
  const tz = schedule.timezone;
  const { hour, minute } = schedule.daily;
  const local = partsInZone(from, tz);
  let cand = zonedLocalToUtc(tz, local.year, local.month, local.day, hour, minute);
  if (cand.getTime() <= from.getTime()) {
    const next = new Date(Date.UTC(local.year, local.month - 1, local.day + 1));
    cand = zonedLocalToUtc(tz, next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate(), hour, minute);
  }
  return cand.toISOString();
}
