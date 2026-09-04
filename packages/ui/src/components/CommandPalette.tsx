import { useEffect, useMemo, useRef, useState } from 'react';
import { cx } from '../lib/cx';
import { StatusGlyph } from './StatusGlyph';
import type { UiStatus } from '@agent-conductor/shared';

export interface Command {
  id: string;
  label: string;
  sub?: string;
  kbd?: string;
  status?: UiStatus;
  group?: string;
  run: () => void;
}

/**
 * ⌘K does everything: Open ticket (⏎), Create ticket (C), Set status (S),
 * Filter board (F), Switch workspace (⌘⇧O). ⇥ scopes the query to a project.
 */
export function CommandPalette({
  open,
  onClose,
  commands,
  scope,
  onScopeCycle,
  onQueryChange,
}: {
  open: boolean;
  onClose: () => void;
  commands: Command[];
  scope?: string | null;
  onScopeCycle?: () => void;
  onQueryChange?: (q: string) => void;
}): React.ReactElement | null {
  const [q, setQ] = useState('');
  const [i, setI] = useState(0);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQ('');
      setI(0);
      queueMicrotask(() => input.current?.focus());
    }
  }, [open]);

  useEffect(() => onQueryChange?.(q), [q, onQueryChange]);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return commands.slice(0, 12);
    return commands
      .filter((c) => `${c.label} ${c.sub ?? ''}`.toLowerCase().includes(needle))
      .slice(0, 12);
  }, [commands, q]);

  useEffect(() => setI(0), [q]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center p-4 pt-[12vh]" role="presentation">
      <div className="absolute inset-0 bg-(--overlay)" onClick={onClose} aria-hidden />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        className="relative w-full max-w-xl overflow-hidden rounded-r10 border border-line-3 bg-bg-1 shadow-sheet motion-safe:animate-[ac-rise_var(--dur-panel)_var(--ease)]"
      >
        <div className="flex items-center gap-2.5 border-b border-line-1 px-4 py-3.5">
          <span className="ac-mono text-ui text-text-nav">›</span>
          <input
            ref={input}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search tickets, run a command…"
            aria-label="Command"
            className="flex-1 bg-transparent text-head text-text-1 outline-none placeholder:text-text-4"
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown' || (e.key === 'n' && e.ctrlKey)) {
                e.preventDefault();
                setI((v) => Math.min(rows.length - 1, v + 1));
              } else if (e.key === 'ArrowUp' || (e.key === 'p' && e.ctrlKey)) {
                e.preventDefault();
                setI((v) => Math.max(0, v - 1));
              } else if (e.key === 'Enter') {
                e.preventDefault();
                rows[i]?.run();
                onClose();
              } else if (e.key === 'Tab') {
                e.preventDefault();
                onScopeCycle?.();
              } else if (e.key === 'Escape') {
                e.preventDefault();
                onClose();
              }
            }}
          />
          {scope ? <span className="ac-mono rounded-r4 bg-accent-tint px-1.5 py-0.5 text-nano text-accent-link">{scope}</span> : null}
          <span className="ac-mono text-nano text-text-4">esc</span>
        </div>

        <div className="ac-scroll max-h-80 p-1.5" role="listbox">
          {rows.length === 0 ? (
            <p className="px-3 py-6 text-center text-meta text-text-3">Nothing matches “{q}”.</p>
          ) : (
            rows.map((c, idx) => (
              <button
                key={c.id}
                type="button"
                role="option"
                aria-selected={idx === i}
                onMouseEnter={() => setI(idx)}
                onClick={() => {
                  c.run();
                  onClose();
                }}
                className={cx('flex h-9 w-full items-center gap-3 rounded-r4 px-3 text-left', idx === i ? 'bg-bg-3' : 'hover:bg-bg-2')}
              >
                {c.status ? <StatusGlyph status={c.status} size="xs" /> : <span className="size-2 flex-none rounded-r4 bg-accent" />}
                <span className={cx('text-ui', idx === i ? 'text-text-1' : 'text-text-soft')}>{c.label}</span>
                {c.sub ? <span className="ac-mono ac-truncate text-meta text-text-nav">{c.sub}</span> : null}
                <span className="flex-1" />
                {c.kbd ? <span className="ac-mono text-nano text-text-4">{c.kbd}</span> : null}
              </button>
            ))
          )}
        </div>

        <div className="ac-mono flex gap-4 border-t border-line-1 px-4 py-2.5 text-nano text-text-4">
          <span>↑↓ navigate</span>
          <span>⏎ run</span>
          <span>⇥ scope to project</span>
        </div>
      </div>
    </div>
  );
}
