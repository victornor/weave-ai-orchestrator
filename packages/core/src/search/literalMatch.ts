/**
 * A query containing a character SQLite FTS5's default `unicode61` tokenizer treats as a word
 * separator (VS-714) tokenizes down to something narrower than what was typed: `_password`
 * degrades to matching just `password`, since the phrase and the indexed text are tokenized the
 * same way at match time regardless of how `ftsQuery()` quoted it. Used by both thread message
 * search (`threads/service.ts`) and spec/change search (`specs/index.ts`) to decide when an FTS
 * match must be narrowed to a literal, case-insensitive substring check against the raw body.
 */
export function needsLiteralMatch(query: string): boolean {
  return /[^A-Za-z0-9\s]/.test(query.trim());
}

/**
 * An excerpt around the first case-insensitive occurrence of `needle` in `body`, the matched text
 * wrapped in the caller's own delimiters — matching whichever pair that call site's `snippet()` SQL
 * already uses (thread search's `\u0002`/`\u0003`, spec search's `[`/`]`) — so a client's existing
 * delimiter-splitting renderer needs no change to highlight a literal match instead of a tokenized
 * one. `needle` is assumed to occur in `body`; callers only call this after already confirming the
 * literal match.
 */
export function literalSnippet(
  body: string,
  needle: string,
  opts: { contextChars?: number; open?: string; close?: string } = {},
): string {
  const { contextChars = 40, open = '\u0002', close = '\u0003' } = opts;
  const idx = body.toLowerCase().indexOf(needle.toLowerCase());
  if (idx === -1) return body.length > contextChars * 2 ? `${body.slice(0, contextChars * 2)}…` : body;
  const start = Math.max(0, idx - contextChars);
  const end = Math.min(body.length, idx + needle.length + contextChars);
  const before = start > 0 ? `…${body.slice(start, idx)}` : body.slice(start, idx);
  const match = body.slice(idx, idx + needle.length);
  const after = end < body.length ? `${body.slice(idx + needle.length, end)}…` : body.slice(idx + needle.length, end);
  return `${before}${open}${match}${close}${after}`;
}
