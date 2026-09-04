import { useState } from 'react';
import type { RunEvent } from '@agent-conductor/shared';
import { runEventsToTranscript } from '../lib/transcript';
import type { TranscriptBlock } from '../lib/transcript';
import { StatusGlyph } from './StatusGlyph';
import { duration, tokens as fmtTokens } from '../lib/format';
import { cx } from '../lib/cx';

export function Transcript({ events, className }: { events: readonly RunEvent[]; className?: string }): React.ReactElement {
  const blocks = runEventsToTranscript(events);
  if (!blocks.length) {
    return <p className="px-4 py-6 text-center text-meta text-text-3">Nothing on the wire yet.</p>;
  }
  return (
    <div className={cx('flex flex-col gap-3 p-3.5', className)}>
      {blocks.map((b) => (
        <TranscriptLine key={b.id} block={b} />
      ))}
    </div>
  );
}

export function TranscriptLine({ block }: { block: TranscriptBlock }): React.ReactElement {
  const [open, setOpen] = useState(false);

  if (block.type === 'text') {
    return <p className={cx('whitespace-pre-wrap text-body leading-relaxed', block.thinking ? 'text-text-3 italic' : 'text-text-body')}>{block.text}</p>;
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
      <span className="ac-mono text-nano text-text-3">{expandable ? (open ? '▾' : '▸') : '▸'}</span>
      <span className={cx('ac-mono text-micro', block.error ? 'text-failed' : 'text-text-2')}>{block.tool}</span>
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
