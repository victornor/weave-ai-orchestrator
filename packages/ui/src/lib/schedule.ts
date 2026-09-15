/** Routine trigger labels (VS-231), shared by the V1 and V2 scheduled screens. */
import type { Routine } from '@weave-ai/shared';

/** How a routine's trigger reads, e.g. `daily 07:00 Europe/Copenhagen`. */
export function scheduleLabel(r: Pick<Routine, 'trigger'>): string {
  const t = r.trigger;
  if ('daily' in t) {
    const hh = String(t.daily.hour).padStart(2, '0');
    const mm = String(t.daily.minute).padStart(2, '0');
    return `daily ${hh}:${mm} ${t.timezone}`;
  }
  return `every ${t.everyMinutes}m ${t.timezone}`;
}

/** An ISO instant as `YYYY-MM-DD HH:MMZ`, or an em dash for null. */
export function dueLabel(iso: string | null): string {
  if (!iso) return '—';
  return iso.slice(0, 16).replace('T', ' ') + 'Z';
}
