import { useMemo, useState } from 'react';
import type { RunEvent } from '@weave-ai/shared';
import { groupConsecutiveTools, reportUiStatus, runEventsToTranscript } from '../lib/transcript';
import type { ToolBlock, TranscriptBlock } from '../lib/transcript';
import { StatusGlyph } from './StatusGlyph';
import { duration, tokens as fmtTokens } from '../lib/format';
import { cx } from '../lib/cx';

/** How many blocks a transcript renders before the rest is behind "Show earlier". */
const WINDOW = 150;

/**
 * A turn of any length renders as its newest `window` blocks. A long run is thousands of events and
 * every one of them is a node with its own state; capping the window is what keeps a page holding
 * several transcripts from paying for turns nobody is reading. Older blocks are a click away, not
 * gone — the window only ever grows, so nothing scrolls out from under the human.
 */
export function Transcript({
  events,
  className,
  window: windowSize = WINDOW,
}: {
  events: readonly RunEvent[];
  className?: string;
  window?: number;
}): React.ReactElement {
  const rows = useMemo(
    () => groupConsecutiveTools(runEventsToTranscript(events)),
    [events],
  );
  // Where the window starts, once the human has asked for more. An absolute index rather than a
  // count from the end, because rows only ever arrive at the end: a count would let the next
  // event push back out of view exactly what they just revealed.
  const [from, setFrom] = useState<number | null>(null);
  const capped = Math.max(0, rows.length - windowSize);
  const hidden = Math.min(from ?? capped, capped);

  if (!rows.length) {
    return <p className="px-4 py-6 text-center text-meta text-text-3">Nothing on the wire yet.</p>;
  }
  return (
    <div className={cx('flex flex-col gap-3 p-3.5', className)}>
      {hidden ? (
        <button
          type="button"
          onClick={() => setFrom(Math.max(0, hidden - windowSize))}
          className="ac-mono self-center rounded-pill border border-line-2 px-2.5 py-1 text-nano text-text-3 hover:bg-bg-3 hover:text-text-1"
        >
          Show earlier ({hidden})
        </button>
      ) : null}
      {rows.slice(hidden).map((row) =>
        row.type === 'tools' ? (
          <ToolGroup key={row.id} tool={row.tool} calls={row.calls} />
        ) : (
          <TranscriptLine key={row.block.id} block={row.block} />
        ),
      )}
    </div>
  );
}

function ToolGroup({ tool, calls }: { tool: string; calls: ToolBlock[] }): React.ReactElement {
  const [open, setOpen] = useState(false);
  const n = calls.length;
  return (
    <div className="overflow-hidden rounded-r4 border border-line-1">
      <button
        type="button"
        className="w-full text-left"
        aria-expanded={open}
        aria-label={`${tool}, ${n} calls`}
        onClick={() => setOpen((v) => !v)}
      >
        <div className="flex items-center gap-2.5 bg-bg-2 px-2.5 py-1.5">
          <span className="ac-mono text-nano text-text-3">{open ? '▾' : '▸'}</span>
          <span className="ac-mono text-micro text-text-2">
            {tool} ×{n}
          </span>
        </div>
      </button>
      {open ? (
        <div className="flex flex-col gap-2 border-t border-line-1 p-2">
          {calls.map((b) => (
            <TranscriptLine key={b.id} block={b} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function TranscriptLine({ block }: { block: TranscriptBlock }): React.ReactElement {
  const [open, setOpen] = useState(false);

  if (block.type === 'text') {
    return <p className={cx('whitespace-pre-wrap text-body leading-relaxed', block.thinking ? 'text-text-3 italic' : 'text-text-body')}>{block.text}</p>;
  }

  if (block.type === 'report') {
    const status = reportUiStatus(block.report.state);
    const head = (
      <div className="flex items-center gap-2.5 bg-bg-2 px-2.5 py-1.5">
        <span className="ac-mono text-nano text-text-3">{open ? '▾' : '▸'}</span>
        <StatusGlyph status={status} size="xs" />
        <span className="ac-mono ac-truncate flex-1 text-micro text-text-2">{block.report.summary}</span>
      </div>
    );
    return (
      <div className="overflow-hidden rounded-r4 border border-line-1">
        <button
          type="button"
          className="w-full text-left"
          aria-expanded={open}
          aria-label={`Turn report: ${block.report.summary}`}
          onClick={() => setOpen((v) => !v)}
        >
          {head}
        </button>
        {open ? <DiffBlock diff={block.text} /> : null}
      </div>
    );
  }

  if (block.type === 'phase') {
    return (
      <div className="flex items-center gap-2.5">
        <StatusGlyph status="working" size="xs" />
        <span className="ac-mono text-micro text-text-3">
          phase: {block.phase}
          {block.durationMs != null ? ` · ${duration(block.durationMs)}` : ''}
          {block.tokens != null ? ` · ${fmtTokens(block.tokens)} tok` : ''}
        </span>
      </div>
    );
  }

  if (block.type === 'status') {
    return (
      <div className="flex items-center gap-2.5">
        <StatusGlyph status={block.status} size="xs" />
        <span className={cx('ac-mono text-micro', block.status === 'needs-you' ? 'text-needs-you' : block.status === 'failed' ? 'text-failed' : 'text-text-2')}>
          {block.text}
        </span>
      </div>
    );
  }

  if (block.type === 'human') {
    return (
      <div className="flex items-center gap-2.5 rounded-r4 border border-line-1 bg-bg-2 px-2.5 py-1.5">
        <span className="ac-mono text-micro text-text-2">→ you: {block.text}</span>
        <span className="ac-mono text-nano text-text-4">{block.delivery === 'mid_turn' ? 'mid-turn' : 'queued'}</span>
      </div>
    );
  }

  if (block.type === 'command') {
    return (
      <div className="overflow-hidden rounded-r4 border border-line-1">
        <div className="flex items-center gap-2.5 bg-bg-2 px-2.5 py-1.5">
          <span className="ac-mono text-micro text-text-3">$</span>
          <span className="ac-mono ac-truncate flex-1 text-micro text-text-soft">{block.command}</span>
          {block.exitCode != null ? <span className={cx('ac-mono text-nano', block.exitCode === 0 ? 'text-done' : 'text-failed')}>exit {block.exitCode}</span> : null}
        </div>
        {block.output ? <pre className="ac-mono max-h-40 overflow-auto px-2.5 py-2 text-micro leading-relaxed text-text-3">{block.output}</pre> : null}
      </div>
    );
  }

  const expandable = Boolean(block.diff);
  const head = (
    <div className={cx('flex items-center gap-2.5 px-2.5 py-1.5', expandable ? 'bg-bg-2' : 'rounded-r4 border border-line-1 bg-bg-2')}>
      <span className="ac-mono text-nano text-text-3">{block.pending ? '·' : expandable ? (open ? '▾' : '▸') : '▸'}</span>
      <span className={cx('ac-mono text-micro', block.denied ? 'text-needs-you' : block.error ? 'text-failed' : block.pending ? 'text-text-3' : 'text-text-2')}>{block.tool}</span>
      <span className="ac-mono ac-truncate flex-1 text-micro text-text-soft">{block.target}</span>
      {block.adds != null || block.dels != null ? (
        <span className="ac-mono text-nano">
          {block.adds != null ? <span className="text-done">+{block.adds}</span> : null}{' '}
          {block.dels != null ? <span className="text-failed">−{block.dels}</span> : null}
        </span>
      ) : block.durationMs != null ? (
        <span className="ac-mono text-nano text-text-4">{duration(block.durationMs)}</span>
      ) : null}
    </div>
  );

  if (!expandable) return head;

  return (
    <div className="overflow-hidden rounded-r4 border border-line-1">
      <button type="button" className="w-full text-left" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        {head}
      </button>
      {open ? <DiffBlock diff={block.diff ?? ''} /> : null}
    </div>
  );
}

export function DiffBlock({ diff }: { diff: string }): React.ReactElement {
  return (
    <div className="ac-mono max-h-72 overflow-auto border-t border-line-1 text-micro leading-relaxed">
      {diff.split('\n').map((line, i) => (
        <div
          key={i}
          className={cx(
            'px-2.5',
            line.startsWith('+') ? 'bg-done/10 text-done' : line.startsWith('-') ? 'bg-failed/10 text-failed' : 'text-text-4',
          )}
        >
          {line || ' '}
        </div>
      ))}
    </div>
  );
}
