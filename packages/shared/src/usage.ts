import type { UsageGrain, UsageWindow } from './enums.js';

export interface UsageRange { start: string; end: string; window: UsageWindow; grain: UsageGrain; prevStart: string; prevEnd: string }

/** Resolve a window name into an absolute UTC range plus the comparison range (PLAN §16.3). Shared by CLI, TUI, web, server. */
export function resolveUsageWindow(window: UsageWindow, grain?: UsageGrain, now = new Date(), custom?: { start: string; end: string }): UsageRange {
  const end = new Date(now);
  let start: Date;
  let g: UsageGrain = grain ?? 'day';
  const dayStart = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  switch (window) {
    case '24h': start = new Date(end.getTime() - 24 * 3600e3); g = grain ?? 'hour'; break;
    case 'today': start = dayStart(end); g = grain ?? 'hour'; break;
    case 'yesterday': { const t = dayStart(end); start = new Date(t.getTime() - 86400e3); end.setTime(t.getTime()); g = grain ?? 'hour'; break; }
    case 'week': { const t = dayStart(end); const dow = (t.getUTCDay() + 6) % 7; start = new Date(t.getTime() - dow * 86400e3); break; }
    case '7d': start = new Date(end.getTime() - 7 * 86400e3); break;
    case 'month': start = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), 1)); break;
    case 'all': start = new Date(0); g = grain ?? 'week'; break;
    case 'custom': if (!custom) throw new Error('custom window requires start/end'); start = new Date(custom.start); end.setTime(new Date(custom.end).getTime()); break;
  }
  const span = end.getTime() - start.getTime();
  return { start: start.toISOString(), end: end.toISOString(), window, grain: g, prevStart: new Date(start.getTime() - span).toISOString(), prevEnd: start.toISOString() };
}

export function bucketKey(ts: string, grain: UsageGrain): string {
  const d = new Date(ts);
  if (grain === 'hour') return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), d.getUTCHours())).toISOString();
  if (grain === 'day') return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())).toISOString();
  const day = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dow = (day.getUTCDay() + 6) % 7;
  return new Date(day.getTime() - dow * 86400e3).toISOString();
}
