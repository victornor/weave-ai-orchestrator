/** Formatting helpers. Machine values are rendered in the mono face by the caller. */

export function tokens(n: number | null | undefined): string {
  if (n == null) return '—';
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${trim((n / 1000).toFixed(1))}k`;
  return `${trim((n / 1_000_000).toFixed(2))}M`;
}

function trim(s: string): string {
  return s.replace(/\.0+$/, '');
}

export function cents(c: number | null | undefined): string {
  if (c == null) return '—';
  const d = c / 100;
  return d >= 100 ? `$${d.toFixed(0)}` : `$${d.toFixed(2)}`;
}

export function pct(n: number, total: number): string {
  if (!total) return '0%';
  return `${Math.round((n / total) * 100)}%`;
}

const UNITS: Array<[number, string]> = [
  [60_000, 's'],
  [3_600_000, 'm'],
  [86_400_000, 'h'],
  [604_800_000, 'd'],
];

export function ago(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return '—';
  const ms = now - new Date(iso).getTime();
  if (ms < 0) return 'now';
  if (ms < 45_000) return 'now';
  for (const [limit, unit] of UNITS) {
    if (ms < limit) {
      const div = limit === 60_000 ? 1000 : limit === 3_600_000 ? 60_000 : limit === 86_400_000 ? 3_600_000 : 86_400_000;
      return `${Math.floor(ms / div)}${unit}`;
    }
  }
  return `${Math.floor(ms / 604_800_000)}w`;
}

export function duration(ms: number | null | undefined): string {
  if (ms == null) return '—';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m${String(s % 60).padStart(2, '0')}s`;
  return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}m`;
}

export function clock(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

export function dayLabel(iso: string, grain: 'hour' | 'day' | 'week'): string {
  const d = new Date(iso);
  if (grain === 'hour') return d.toLocaleTimeString(undefined, { hour: '2-digit' });
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function initials(name: string): string {
  const parts = name.replace(/#\d+\s*$/, '').trim().split(/\s+/);
  const first = parts[0]?.[0] ?? '?';
  const last = parts.length > 1 ? parts[parts.length - 1]?.[0] ?? '' : '';
  return (first + last).toUpperCase();
}

export function titleCase(s: string): string {
  return s.replace(/[_-]/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase());
}

/** `in_review` → `IN REVIEW` for the micro/11 uppercase style. */
export function statusText(s: string): string {
  return s.replace(/_/g, ' ');
}
