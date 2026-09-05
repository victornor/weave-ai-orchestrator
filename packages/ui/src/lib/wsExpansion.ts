/**
 * Which workspace groups the sidebar has open, remembered per device.
 *
 * This is a view preference, not workspace state, so it lives in `localStorage` rather than the
 * workspace config: a toggle costs no round-trip, and two devices can keep different workspaces
 * open. Every access is guarded the same way `api/client.ts` guards its own — private mode throws
 * on `localStorage`, and a sidebar that cannot remember its expansion must still expand.
 */

const KEY = 'conductor.ws.expanded';

/** The remembered set. An absent, unreadable or malformed value reads as "nothing remembered". */
export function readExpanded(): string[] {
  let raw: string | null;
  try {
    raw = localStorage.getItem(KEY);
  } catch {
    return [];
  }
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

export function writeExpanded(keys: readonly string[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify([...keys]));
  } catch {
    /* private mode: the session keeps its expansion in memory, the device just does not remember it */
  }
}

/**
 * Add or remove one workspace and persist the result. A key for a workspace the daemon no longer
 * reports is carried through untouched, so a workspace that comes back reopens as it was left.
 */
export function toggleExpanded(current: readonly string[], key: string): string[] {
  const next = current.includes(key) ? current.filter((k) => k !== key) : [...current, key];
  writeExpanded(next);
  return next;
}
