import { useCallback, useMemo, useState } from 'react';
import type { RunEvent } from '@weave-ai/shared';
import { diffHunksForEdits, type DiffHunk } from '@weave-ai/render';
import { groupConsecutiveTools, reportUiStatus, runEventsToTranscript } from '../lib/transcript';
import type { EditPayload, ToolBlock, TranscriptBlock } from '../lib/transcript';
import { StatusGlyph } from './StatusGlyph';
import { Markdown } from './Markdown';
import { Code, SplitHunk, UnifiedHunk, type Highlighter } from './DiffHunks';
import { highlightLine, languageForPath, useHighlighter } from '../lib/highlight';
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

/** A thinking block collapsed to one line naming its duration when derivable (VS-324), expanding to
 * the same markdown rendering VS-319 already produces. No runtime reports this duration directly —
 * `runEventsToTranscript` derives it from the gap to the next event — so it is absent, not zero,
 * when it cannot be derived. */
function ThinkingLine({ text, durationMs }: { text: string; durationMs: number | null }): React.ReactElement {
  const [open, setOpen] = useState(false);
  return (
    <div className="overflow-hidden rounded-r4 border border-line-1">
      <button
        type="button"
        className="w-full text-left"
        aria-expanded={open}
        aria-label={durationMs != null ? `Thought, ${duration(durationMs)}` : 'Thought'}
        onClick={() => setOpen((v) => !v)}
      >
        <div className="flex items-center gap-2.5 bg-bg-2 px-2.5 py-1.5">
          <span className="ac-mono text-nano text-text-3">{open ? '▾' : '▸'}</span>
          <span className="ac-mono text-micro text-text-3">Thought{durationMs != null ? ` · ${duration(durationMs)}` : ''}</span>
        </div>
      </button>
      {open ? (
        <div className="border-t border-line-1 p-2.5">
          <Markdown source={text} breaks className="text-body italic leading-relaxed text-text-3" />
        </div>
      ) : null}
    </div>
  );
}

export function TranscriptLine({ block }: { block: TranscriptBlock }): React.ReactElement {
  // An edit-type row starts expanded (VS-324 review): captain's ask was to see the diff itself,
  // not a second click to reveal it. The header still collapses it like any other row.
  const [open, setOpen] = useState(() => block.type === 'tool' && Boolean(block.editPayload));

  if (block.type === 'text') {
    if (block.thinking) return <ThinkingLine text={block.text} durationMs={block.thinkingDurationMs ?? null} />;
    return <Markdown source={block.text} breaks className="text-body leading-relaxed text-text-body" />;
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

  const expandable = Boolean(block.diff) || Boolean(block.editPayload);
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
      {open ? (
        block.editPayload ? (
          <EditPayloadBody id={block.id} path={block.target} payload={block.editPayload} />
        ) : (
          <DiffBlock diff={block.diff ?? ''} />
        )
      ) : null}
    </div>
  );
}

/**
 * An edit-type tool call's expanded body: a diff per edit, or a written file's content — whichever
 * `payload.kind` says (VS-324). Syntax highlighting is inferred from `path`'s extension, matching
 * the pull request diff view.
 *
 * `id` (the block's own id, stable and never reassigned once a `tool.call` creates it — `editPayload`
 * is set once and never mutated afterward) is the hunk memo's key, not `payload` itself: every edit
 * row now renders expanded by default, and `runEventsToTranscript` rebuilds every block — a fresh
 * object, fresh nested arrays — on every new event. Memoising on the object would rerun the LCS diff
 * for every visible edit on every live event; the id alone is enough, since the same id can only
 * ever carry the same edits (VS-324 review).
 */
export function EditPayloadBody({ id, path, payload }: { id: string; path: string; payload: EditPayload }): React.ReactElement {
  const hljs = useHighlighter();
  const lang = languageForPath(path);
  const highlight = useCallback<Highlighter>((text) => highlightLine(hljs, text, lang), [hljs, lang]);
  // Hooks run unconditionally regardless of `payload.kind`; the write branch simply never uses
  // `hunks`. Deliberately keyed on `id` alone, not `payload` — see the doc comment above.
  const hunks = useMemo(() => (payload.kind === 'edit' ? diffHunksForEdits(payload.edits) : []), [id]);

  if (payload.kind === 'write') {
    return <WrittenFile content={payload.content} highlight={highlight} />;
  }
  return (
    <div className="flex flex-col divide-y divide-line-1 border-t border-line-1">
      {hunks.map((hunk, i) => (
        <EditHunk key={i} hunk={hunk} highlight={highlight} />
      ))}
    </div>
  );
}

/** How many lines a long edit hunk or a written file shows before the rest is behind "Show more",
 * mirroring `Transcript`'s own "Show earlier" windowing — low enough that a big edit or a large
 * written file does not flood a cell now that both render expanded by default (VS-324 review). */
const CONTENT_WINDOW = 40;

/** Side by side only when two code columns actually read, unified otherwise — decided per rendered
 * instance by a CSS container query, since a transcript cell's width varies continuously by drag
 * rather than by viewport breakpoint, and cannot be measured in the test harness (VS-324 design.md;
 * see also `workspace-navigation/live-floor`'s own jsdom-geometry landmine).
 *
 * `48rem` (VS-344): the diff renders at `text-nano` (10px JetBrains Mono, 6px per character), so a
 * readable ~48-character column is ~288px; with the 2.5rem line-number gutter and padding each side
 * spends ~52px, and two columns need ~680px. 48rem leaves ~332px of code per column (~55
 * characters). 32rem gave ~204px (~34 characters) and switched split on in cells too narrow to read
 * it. A default half-cell at either breakpoint (and a full-width `sm` cell) stays below 48rem and is
 * unified; only a cell widened towards the `xl` grid's full width crosses into split.
 *
 * The `@min-[48rem]` classes are written literally, not composed from the comment above: Tailwind's
 * scanner reads source text, so a generated class would never be emitted. */
function EditHunk({ hunk, highlight }: { hunk: DiffHunk; highlight: Highlighter }): React.ReactElement {
  const [shown, setShown] = useState(() => Math.min(hunk.lines.length, CONTENT_WINDOW));
  const windowed = shown >= hunk.lines.length ? hunk : { ...hunk, lines: hunk.lines.slice(0, shown) };
  return (
    <div className="ac-mono text-nano">
      <div className="@container">
        <div className="hidden @min-[48rem]:block">
          <SplitHunk hunk={windowed} highlight={highlight} />
        </div>
        <div className="@min-[48rem]:hidden">
          <UnifiedHunk hunk={windowed} highlight={highlight} />
        </div>
      </div>
      {shown < hunk.lines.length ? (
        <button
          type="button"
          onClick={() => setShown((n) => Math.min(hunk.lines.length, n + CONTENT_WINDOW))}
          className="ac-mono w-full border-t border-line-1 px-2.5 py-1 text-left text-nano text-text-3 hover:bg-bg-3 hover:text-text-1"
        >
          Show {hunk.lines.length - shown} more lines
        </button>
      ) : null}
    </div>
  );
}

function WrittenFile({ content, highlight }: { content: string; highlight: Highlighter }): React.ReactElement {
  const lines = useMemo(() => content.split('\n'), [content]);
  const [shown, setShown] = useState(() => Math.min(lines.length, CONTENT_WINDOW));
  const visible = lines.slice(0, shown);
  return (
    <div className="ac-mono border-t border-line-1 text-nano">
      {visible.map((line, i) => (
        <div key={i} className="flex whitespace-pre">
          <span className="w-10 flex-none select-none px-1.5 text-right text-text-4">{i + 1}</span>
          <span className="px-1.5"><Code text={line} highlight={highlight} /></span>
        </div>
      ))}
      {shown < lines.length ? (
        <button
          type="button"
          onClick={() => setShown((n) => Math.min(lines.length, n + CONTENT_WINDOW))}
          className="ac-mono w-full border-t border-line-1 px-2.5 py-1 text-left text-nano text-text-3 hover:bg-bg-3 hover:text-text-1"
        >
          Show {lines.length - shown} more lines
        </button>
      ) : null}
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
            line.startsWith('+') ? 'bg-diff-add-bg text-diff-add-fg' : line.startsWith('-') ? 'bg-diff-remove-bg text-diff-remove-fg' : 'text-text-4',
          )}
        >
          {line || ' '}
        </div>
      ))}
    </div>
  );
}
