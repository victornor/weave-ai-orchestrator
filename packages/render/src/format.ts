/** Formatting helpers shared by the web UI and the TUI (design contract §2 "mono/12" values). */
import type { CostStatus } from '@weave-ai/shared';

/** 940 · 18.4k · 1.2M · 0 — never scientific notation, always short enough for a status bar. */
export function formatTokens(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  const v = Math.max(0, Math.round(n));
  if (v < 1000) return String(v);
  if (v < 1_000_000) {
    const k = v / 1000;
    return `${k < 100 ? trim1(k) : Math.round(k)}k`;
  }
  const m = v / 1_000_000;
  return `${m < 100 ? trim1(m) : Math.round(m)}M`;
}

function trim1(v: number): string {
  const s = v.toFixed(1);
  return s.endsWith('.0') ? s.slice(0, -2) : s;
}

/** 512B · 4.2KB · 1.1MB — an attachment's size, on the same "short and never scientific" terms as `formatTokens`. */
export function formatBytes(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  const v = Math.max(0, Math.round(n));
  if (v < 1024) return `${v}B`;
  if (v < 1024 * 1024) return `${trim1(v / 1024)}KB`;
  return `${trim1(v / (1024 * 1024))}MB`;
}

/** Cents → `$0.41`. Sub-cent amounts keep a leading `<`. */
export function formatCents(cents: number | null | undefined): string {
  if (cents === null || cents === undefined || !Number.isFinite(cents)) return '—';
  if (cents === 0) return '$0.00';
  if (cents > 0 && cents < 1) return '<$0.01';
  const usd = cents / 100;
  if (usd >= 1000) return `$${Math.round(usd).toLocaleString('en-US')}`;
  return `$${usd.toFixed(2)}`;
}

/**
 * Cost with its provenance label (§7.12: provenance is a label, never a badge on every number).
 * `reported` prints bare, `estimated` gets ` est`, `unpriced` prints an em dash.
 */
export function formatCost(cents: number | null | undefined, status?: CostStatus | null): string {
  if (status === 'unpriced') return '—';
  const base = formatCents(cents);
  if (base === '—') return base;
  return status === 'estimated' ? `${base} est` : base;
}

/** 0.4s · 4m12s · 1h02m · 320ms */
export function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms) || ms < 0) return '—';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const s = ms / 1000;
  if (s < 60) return `${trim1(s)}s`;
  const totalSec = Math.round(s);
  const m = Math.floor(totalSec / 60);
  const rem = totalSec % 60;
  if (m < 60) return `${m}m${String(rem).padStart(2, '0')}s`;
  const h = Math.floor(m / 60);
  return `${h}h${String(m % 60).padStart(2, '0')}m`;
}

/** "just now" · "2m ago" · "3h ago" · "6d ago" · "12 Mar" */
export function formatRelative(ts: string | number | Date | null | undefined, now: Date = new Date()): string {
  if (ts === null || ts === undefined) return '—';
  const t = ts instanceof Date ? ts.getTime() : typeof ts === 'number' ? ts : Date.parse(ts);
  if (!Number.isFinite(t)) return '—';
  const diff = now.getTime() - t;
  if (diff < 0) return 'just now';
  const sec = Math.floor(diff / 1000);
  if (sec < 45) return 'just now';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${Math.max(1, min)}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}d ago`;
  const d = new Date(t);
  return `${d.getUTCDate()} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getUTCMonth()]}`;
}

/** Short age used on ticket cards: 4m · 3h · 6d · 8w */
export function formatAge(ts: string | number | Date | null | undefined, now: Date = new Date()): string {
  if (ts === null || ts === undefined) return '—';
  const t = ts instanceof Date ? ts.getTime() : typeof ts === 'number' ? ts : Date.parse(ts);
  if (!Number.isFinite(t)) return '—';
  const sec = Math.max(0, Math.floor((now.getTime() - t) / 1000));
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  const day = Math.floor(hr / 24);
  if (day < 14) return `${day}d`;
  return `${Math.floor(day / 7)}w`;
}

/** Window-over-window delta: `+18%` · `−7%` · `new` · `—`. Uses the real minus sign. */
export function formatDelta(current: number, previous: number): string {
  if (!Number.isFinite(current) || !Number.isFinite(previous)) return '—';
  if (previous === 0) return current === 0 ? '—' : 'new';
  const pct = ((current - previous) / Math.abs(previous)) * 100;
  if (Math.abs(pct) < 0.5) return '±0%';
  const sign = pct > 0 ? '+' : '−';
  return `${sign}${Math.abs(pct) < 10 ? trim1(Math.abs(pct)) : Math.round(Math.abs(pct))}%`;
}

/** `79 % reported` — cost provenance as a share on totals (design contract §7.12). */
export function formatReportedShare(share: number | null | undefined): string | null {
  if (share === null || share === undefined || !Number.isFinite(share)) return null;
  const pct = share <= 1 ? share * 100 : share;
  return `${Math.round(pct)}% reported`;
}

/** `+18 −2` diff counters. */
export function formatDiffStat(additions: number | null | undefined, deletions: number | null | undefined): string | null {
  const a = Number.isFinite(additions as number) ? (additions as number) : null;
  const d = Number.isFinite(deletions as number) ? (deletions as number) : null;
  if (a === null && d === null) return null;
  return `+${a ?? 0} −${d ?? 0}`;
}

/** Join non-empty parts with the interpunct used everywhere in the design. */
export function joinMeta(...parts: Array<string | null | undefined | false>): string {
  return parts.filter((p): p is string => typeof p === 'string' && p.length > 0).join(' · ');
}

/** Single-line, whitespace-collapsed, ellipsised at `max`. */
export function oneLine(text: string | null | undefined, max = 120): string {
  if (!text) return '';
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length <= max ? flat : `${flat.slice(0, Math.max(0, max - 1))}…`;
}

/** Two-letter initials for avatars ("Backend Engineer" → "BE", "conductor" → "CO"). */
export function initials(name: string | null | undefined): string {
  if (!name) return '··';
  const words = name.trim().split(/[\s_-]+/).filter(Boolean);
  if (words.length === 0) return '··';
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase();
  return `${words[0]![0]!}${words[1]![0]!}`.toUpperCase();
}

/**
 * Time left until a moment, at the granularity a header can carry: `2h 10m` · `47m` · `3d 4h` ·
 * `now`. Finer than `formatRelative` on purpose — a countdown that only moves once an hour reads
 * as frozen. Null when there is no target, so the caller can leave the phrase out entirely.
 */
export function formatCountdown(target: string | number | Date | null | undefined, now: Date = new Date()): string | null {
  if (target === null || target === undefined) return null;
  const t = target instanceof Date ? target.getTime() : typeof target === 'number' ? target : Date.parse(target);
  if (!Number.isFinite(t)) return null;
  const min = Math.floor((t - now.getTime()) / 60_000);
  if (min <= 0) return 'now';
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) {
    const rem = min % 60;
    return rem ? `${hr}h ${rem}m` : `${hr}h`;
  }
  const day = Math.floor(hr / 24);
  const rem = hr % 24;
  return rem ? `${day}d ${rem}h` : `${day}d`;
}
