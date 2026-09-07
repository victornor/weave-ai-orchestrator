/**
 * Which turns' work traces the human has opened, remembered for the browsing session (VS-74).
 *
 * `sessionStorage`, beside the composer drafts, and for the same reason: reading back through a
 * long history and opening half a dozen traces is work, and losing it on a route change would make
 * the chat feel like it forgets. It is a reading position rather than a preference, so it does not
 * outlive the tab. Scoped to the workspace, because run ids from one say nothing about another.
 *
 * Every access is guarded the way `wsExpansion` and `drafts` guard theirs — private mode throws on
 * `sessionStorage`, and a chat that cannot remember what was open must still open it.
 */

const KEY = 'conductor.chat.traces';

function read(): Record<string, string[]> {
  let raw: string | null;
  try {
    raw = sessionStorage.getItem(KEY);
  } catch {
    return {};
  }
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, string[]>) : {};
  } catch {
    return {};
  }
}

/** The run ids open in this workspace. An unreadable or malformed store reads as "nothing open". */
export function readExpandedTraces(ws: string): string[] {
  const all = read()[ws];
  return Array.isArray(all) ? all.filter((v): v is string => typeof v === 'string') : [];
}

/** Open or close one turn and persist the result, returning the new set for this workspace. */
export function toggleExpandedTrace(ws: string, runId: string): string[] {
  const all = read();
  const current = readExpandedTraces(ws);
  const next = current.includes(runId) ? current.filter((id) => id !== runId) : [...current, runId];
  try {
    sessionStorage.setItem(KEY, JSON.stringify({ ...all, [ws]: next }));
  } catch {
    /* private mode: the session keeps its expansion in memory, the tab just does not remember it */
  }
  return next;
}
