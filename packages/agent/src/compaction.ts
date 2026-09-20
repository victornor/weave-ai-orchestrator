import { SUMMARY_PREFIX, type FileLists, type Session } from './session.js';
import { messageTokens, messagesTokens, sliceToTokens, textTokens } from './tokens.js';
import type { Message } from './types.js';

export const NOTHING_TO_SUMMARISE = 'nothing to summarise';
export const DEFAULT_KEEP_RECENT_TOKENS = 20_000;
export const MIN_OUTPUT_RESERVE = 16_384;
/** A tool result inside the span being summarised is cut to this many characters for the summary input. */
export const SUMMARY_RESULT_CHARS = 2000;
export const SUMMARY_MAX_OUTPUT_TOKENS = 8192;
/** The newest human message is carried verbatim when the cut passes it, up to this many characters. */
const PINNED_USER_CHARS = 32_000;

export const SUMMARY_SYSTEM = [
  'You compress the earlier part of a coding agent conversation into a summary that lets the agent continue the work.',
  'Reply with the summary only, in exactly these sections, each a short list:',
  '## Goal', '## Constraints', '## Progress (done / in progress)', '## Decisions', '## Files read and modified', '## Next steps', '## Critical context',
  'Keep names, paths, commands, error messages and numbers exactly. When a previous summary is given, update it: keep what still matters, add what happened since, drop what is finished and no longer needed.',
].join('\n');

/** Where the proactive trigger fires: the window less room for the reply. */
export function compactionThreshold(window: number, maxOutputTokens: number | undefined): number {
  const reserve = Math.max(MIN_OUTPUT_RESERVE, maxOutputTokens ?? 0);
  // A small window must still leave room for work: never trigger below half of it.
  return Math.max(Math.floor(window * 0.5), window - reserve);
}

/** A cut may start the kept span at a user or an assistant message, never at a tool result. */
const isBoundary = (m: Message): boolean => m.role !== 'toolResult';

/**
 * The index in `messages` where the kept span starts, or null when nothing can be summarised. Walks back
 * from the newest message until `keepRecentTokens` are kept, then moves earlier to the nearest boundary,
 * so an assistant tool-call message is never separated from the results that follow it. `from` is where the
 * visible history already starts.
 */
export function findCut(messages: readonly Message[], from: number, keepRecentTokens: number): number | null {
  let acc = 0;
  let cut = messages.length;
  if (cut <= from + 1) return null;
  for (let i = messages.length - 1; i > from; i--) {
    acc += messageTokens(messages[i]!);
    cut = i;
    if (acc >= keepRecentTokens) break;
  }
  while (cut > from && !isBoundary(messages[cut]!)) cut--;
  return cut > from ? cut : null;
}

/** Read and modified paths named by the `read`, `write` and `edit` calls in a span. */
export function filesFrom(span: readonly Message[]): FileLists {
  const read = new Set<string>(); const modified = new Set<string>();
  for (const m of span) {
    if (m.role !== 'assistant') continue;
    for (const b of m.content) {
      if (b.type !== 'toolCall' || typeof b.args !== 'object' || b.args === null) continue;
      const p = (b.args as Record<string, unknown>)['path'];
      if (typeof p !== 'string' || !p) continue;
      if (b.name === 'read') read.add(p); else if (b.name === 'write' || b.name === 'edit') modified.add(p);
    }
  }
  return { read: [...read], modified: [...modified] };
}
export function mergeFiles(a: FileLists | undefined, b: FileLists): FileLists {
  return { read: [...new Set([...(a?.read ?? []), ...b.read])], modified: [...new Set([...(a?.modified ?? []), ...b.modified])] };
}

/** The span as text for the summariser: tool results cut short, tool calls one line each. */
export function serialiseSpan(span: readonly Message[]): string {
  const cut = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n)}… [${s.length - n} more chars]` : s);
  return span.map((m) => {
    if (m.role === 'user') return `[user]\n${m.text}`;
    if (m.role === 'toolResult') return `[tool result: ${m.name}${m.isError ? ' (error)' : ''}]\n${cut(m.text, SUMMARY_RESULT_CHARS)}`;
    return m.content.map((b) => (b.type === 'text' ? `[assistant]\n${b.text}` : b.type === 'toolCall' ? `[tool call: ${b.name}] ${cut(JSON.stringify(b.args), 500)}` : '')).filter(Boolean).join('\n');
  }).join('\n\n');
}

export function summaryPrompt(previous: string | null, span: readonly Message[], maxInputTokens: number): string {
  let text = serialiseSpan(span);
  // The newest part matters most: when the span itself will not fit, the oldest part is dropped.
  if (textTokens(text) > maxInputTokens) text = `[earlier part omitted]\n${text.slice(text.length - Math.floor(text.length * (maxInputTokens / textTokens(text)) * 0.9))}`;
  return `${previous ? `<previous-summary>\n${previous}\n</previous-summary>\n\n` : ''}<conversation>\n${text}\n</conversation>\n\nWrite the summary now.`;
}

export interface CompactOutcome { ok: boolean; tokensBefore?: number; tokensAfter?: number; reason?: string }
export interface CompactDeps {
  session: Session;
  window: number | undefined;
  keepRecentTokens?: number;
  /** One completion with the run's provider and no tools; rejects on failure. */
  complete(system: string, user: string): Promise<string>;
  log?(level: 'info' | 'warn', msg: string, fields?: Record<string, unknown>): void;
}

/**
 * Summarise everything before the cut and append a compaction entry. Leaves the session untouched when there
 * is nothing to summarise or the summary fails. When the cut passes the newest user message, that message is
 * carried into the summary word for word so the request the agent is working on is never lost.
 */
export async function compact(d: CompactDeps): Promise<CompactOutcome> {
  const { session } = d;
  const all = session.messages;
  const from = session.keptFrom;
  const keep = Math.min(d.keepRecentTokens ?? DEFAULT_KEEP_RECENT_TOKENS, d.window ? Math.floor(d.window * 0.25) : Infinity);
  const cut = findCut(all, from, keep);
  if (cut === null) return { ok: false, reason: NOTHING_TO_SUMMARISE };
  const span = all.slice(from, cut);
  const before = messagesTokens(session.context());
  const previous = session.lastCompaction;
  let summary: string;
  try {
    summary = (await d.complete(SUMMARY_SYSTEM, summaryPrompt(previous?.summary ?? null, span, d.window ? Math.floor(d.window * 0.7) - SUMMARY_MAX_OUTPUT_TOKENS : 150_000))).trim();
  } catch (e) { d.log?.('warn', 'compaction summary failed', { error: (e as Error).message }); return { ok: false, reason: (e as Error).message }; }
  if (!summary) { d.log?.('warn', 'compaction summary was empty'); return { ok: false, reason: 'empty summary' }; }
  const files = mergeFiles(previous?.files, filesFrom(span));
  const list = [files.read.length ? `Files read: ${files.read.join(', ')}` : '', files.modified.length ? `Files modified: ${files.modified.join(', ')}` : ''].filter(Boolean).join('\n');
  let newestUser = -1;
  for (let i = all.length - 1; i >= from; i--) if (all[i]!.role === 'user' && !isSyntheticUser(all[i]!)) { newestUser = i; break; }
  const pinned = newestUser >= from && newestUser < cut ? `\n\n## Latest user request (verbatim)\n${sliceText((all[newestUser] as { text: string }).text)}` : '';
  const full = `${summary}${list ? `\n\n${list}` : ''}${pinned}`;
  const after = messagesTokens([{ role: 'user', text: `${SUMMARY_PREFIX}${full}` }, ...all.slice(cut)]);
  session.compact({ summary: full, firstKeptIndex: cut, tokensBefore: before, tokensAfter: after, files });
  return { ok: true, tokensBefore: before, tokensAfter: after };
}

const isSyntheticUser = (m: Message): boolean => m.role === 'user' && m.text.startsWith('Your previous reply was cut off');
const sliceText = (s: string): string => (s.length > PINNED_USER_CHARS ? sliceToTokens(s, 8000) : s);
