/**
 * V2 thread search (web-v2/chat-composer): full-text search over a thread's whole stored history
 * through the shared `useThreadSearch` hook, with V2 markup. Choosing a result hands its message id
 * back so the screen can move the conversation to it.
 */
import { useEffect, useRef, useState } from 'react';
import { useThreadSearch } from '../api/hooks';
import { clock, dayLabel } from '../lib/format';

/** `snippet()` marks the matched text with STX/ETX, so the highlight is rendered here, never trusted. */
function renderSnippet(snippet: string): React.ReactNode {
  return snippet.split(/(\u0002[^\u0002\u0003]*\u0003)/g).map((part, i) =>
    part.startsWith('\u0002') && part.endsWith('\u0003') ? (
      <mark key={i} className="bg-accent/25 px-0.5 text-text-1">{part.slice(1, -1)}</mark>
    ) : (
      <span key={i}>{part}</span>
    ),
  );
}

export function SearchPanel({
  threadId,
  open,
  onClose,
  onSelect,
}: {
  threadId: string | null;
  open: boolean;
  onClose: () => void;
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
    <div className="v2-anim-fade absolute inset-0 z-30 flex items-start justify-center p-4" role="presentation">
      <button type="button" aria-label="Close search" onClick={onClose} className="absolute inset-0 bg-(--overlay)" />
      <div role="dialog" aria-modal="true" aria-label="Search this conversation" className="v2-anim-pop relative w-full max-w-xl overflow-hidden rounded-r6 border border-line-3 bg-bg-1">
        <div className="flex items-center gap-2.5 border-b border-line-1 px-4 py-3">
          <span className="ac-mono text-ui text-text-3" aria-hidden>⌕</span>
          <input
            ref={input}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search this conversation…"
            aria-label="Search messages"
            className="flex-1 bg-transparent text-head text-text-1 outline-none placeholder:text-text-4"
            onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); onClose(); } }}
          />
        </div>
        <div className="max-h-[60vh] overflow-y-auto p-2">
          {query.length === 0 ? (
            <div className="px-3 py-6 text-center text-micro text-text-4">Type to search every message in this conversation.</div>
          ) : isLoading ? (
            <div className="px-3 py-6 text-center text-micro text-text-4">Searching…</div>
          ) : results.length === 0 ? (
            <div role="status" className="px-3 py-6 text-center text-micro text-text-4">No messages match “{query}”.</div>
          ) : (
            <ul>
              {results.map((r) => (
                <li key={r.messageId}>
                  <button type="button" onClick={() => onSelect(r.messageId)} className="flex w-full flex-col items-start gap-0.5 rounded-r4 px-3 py-2 text-left hover:bg-bg-2">
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
