import { useEffect, useRef, useState } from 'react';
import { useThreadSearch } from '../api/hooks';
import { clock, dayLabel } from '../lib/format';

/**
 * Full-text search over a thread's entire stored history (VS-320), not only the page the chat has
 * loaded. Modeled on `CommandPalette`'s dialog shape, but its own component: this searches one
 * thread's messages, not tickets and commands.
 */
export function ThreadSearchPanel({
  threadId,
  open,
  onClose,
  onSelect,
}: {
  threadId: string | null;
  open: boolean;
  onClose: () => void;
  /** The chosen result's message id — the caller jumps the conversation to it and closes the panel. */
  onSelect: (messageId: string) => void;
}): React.ReactElement | null {
  const [q, setQ] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const { data: results, isLoading } = useThreadSearch(open ? threadId : null, q);

  useEffect(() => {
    if (open) {
      setQ('');
      queueMicrotask(() => input.current?.focus());
    }
  }, [open]);

  if (!open) return null;

  const query = q.trim();

  return (
    <div className="ac-viewport fixed z-[70] flex items-start justify-center p-4 pt-[calc(var(--ac-app-h)*0.12)]" role="presentation">
      <div className="absolute inset-0 bg-(--overlay)" onClick={onClose} aria-hidden />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Search this conversation"
        className="relative w-full max-w-xl overflow-hidden rounded-r10 border border-line-3 bg-bg-1 shadow-sheet motion-safe:animate-[ac-rise_var(--dur-panel)_var(--ease)]"
      >
        <div className="flex items-center gap-2.5 border-b border-line-1 px-4 py-3.5">
          <span className="ac-mono text-ui text-text-nav" aria-hidden>⌕</span>
          <input
            ref={input}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search this conversation…"
            aria-label="Search messages"
            className="flex-1 bg-transparent text-head text-text-1 outline-none placeholder:text-text-4"
            onKeyDown={(e) => {
              if (e.key === 'Escape') { e.preventDefault(); onClose(); }
            }}
          />
        </div>
        <div className="max-h-[60vh] overflow-y-auto p-2">
          {query.length === 0 ? (
            <div className="px-3 py-6 text-center text-micro text-text-4">Type to search every message in this conversation.</div>
          ) : isLoading ? (
            <div className="px-3 py-6 text-center text-micro text-text-4">Searching…</div>
          ) : results.length === 0 ? (
            <div role="status" className="px-3 py-6 text-center text-micro text-text-4">No messages match &ldquo;{query}&rdquo;.</div>
          ) : (
            <ul>
              {results.map((r) => (
                <li key={r.messageId}>
                  <button
                    type="button"
                    onClick={() => onSelect(r.messageId)}
                    className="flex w-full flex-col items-start gap-0.5 rounded-r6 px-3 py-2 text-left hover:bg-bg-2"
                  >
                    <span className="flex items-center gap-1.5 text-nano text-text-4">
                      <span>{r.authorKind === 'human' ? 'You' : 'Weaver'}</span>
                      <span aria-hidden>·</span>
                      <span className="ac-mono">{dayLabel(r.createdAt, 'day')} {clock(r.createdAt)}</span>
                    </span>
                    <span className="line-clamp-2 text-body text-text-1">{renderSnippet(r.snippet)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

/** `snippet()` marks the matched text with `\u0002` / `\u0003` (STX/ETX — never raw HTML —
 * `packages/core`'s `ThreadsService.search()`), so the highlight is rendered here, not trusted from
 * the server. Not `[` / `]`: this chat's own messages are full of literal brackets — markdown links
 * (`[PR #267](...)`), checkboxes (`[x]`), `[Risk]`-style labels — and any of those in a result would
 * misread as a match. */
function renderSnippet(snippet: string): React.ReactNode {
  return snippet.split(/(\u0002[^\u0002\u0003]*\u0003)/g).map((part, i) =>
    part.startsWith('\u0002') && part.endsWith('\u0003') ? (
      <mark key={i} className="rounded-r4 bg-accent/25 px-0.5 text-text-1">{part.slice(1, -1)}</mark>
    ) : (
      <span key={i}>{part}</span>
    ),
  );
}
