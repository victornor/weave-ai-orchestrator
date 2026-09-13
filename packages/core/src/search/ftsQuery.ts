/** Shared FTS5 query sanitiser: user queries are plain text, so every term is stripped of FTS5's
 * operator syntax and quoted. Used by both spec/change search (`specs/index.ts`) and thread message
 * search (`threads/service.ts`) against `knowledge_search`/`thread_message_search` respectively. */
export function ftsQuery(query: string): string {
  return query
    .replace(/["'^*:()\[\]{}~+\-]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 0)
    .map((t) => `"${t}"`)
    .join(' ');
}
