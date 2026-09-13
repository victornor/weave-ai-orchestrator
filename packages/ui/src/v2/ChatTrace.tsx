/**
 * The V2 chat trace (web-v2/chat).
 *
 * The run-events view model (`runEventsToTranscript` + `groupConsecutiveTools`, VS-319) rendered in
 * V2's Mono language: narration between tool calls is italic in a dimmer ink, a tool row names the
 * tool and its argument, and a tool's result lines are indented two spaces under the call that
 * produced them. Text blocks keep markdown. This is Chat's inline trace; VS-345's `WorkerFeed` is the
 * bounded feed for cards and Live.
 */
import { useMemo, useState } from 'react';
import type { RunEvent, RunTrace } from '@weave-ai/shared';
import { contextStrip } from '@weave-ai/render';
import { groupConsecutiveTools, runEventsToTranscript } from '../lib/transcript';
import type { ToolBlock, TranscriptBlock, TranscriptRow } from '../lib/transcript';
import { Markdown } from '../components/Markdown';
import { useRunEvents } from '../api/hooks';
import { duration as fmtDuration, tokens as fmtTokens } from '../lib/format';
import { cx } from '../lib/cx';

export function ChatTrace({ events, className }: { events: readonly RunEvent[]; className?: string }): React.ReactElement {
  const rows = useMemo(() => groupConsecutiveTools(runEventsToTranscript(events)), [events]);
  if (rows.length === 0) return <p className={cx('text-nano text-text-4', className)}>Nothing on the wire yet.</p>;
  return (
    <div className={cx('flex flex-col gap-1.5', className)} data-v2-trace>
      {rows.map((row) => (row.type === 'tools' ? <ToolGroup key={row.id} row={row} /> : <TraceLine key={row.block.id} block={row.block} />))}
    </div>
  );
}

/** The tool's argument, or the tail of its result body when there is no separate argument. */
function ToolRow({ block, marker = '▸' }: { block: ToolBlock; marker?: string }): React.ReactElement {
  const tone = block.denied ? 'text-needs-you' : block.error ? 'text-failed' : 'text-text-2';
  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-center gap-2" data-trace-tool>
        <span className="ac-mono flex-none text-nano text-text-4">{marker}</span>
        <span className={cx('ac-mono flex-none text-nano', tone)}>{block.tool}</span>
        {block.target ? <span className="ac-mono min-w-0 flex-1 truncate text-nano text-text-3">{block.target}</span> : <span className="flex-1" />}
        {block.adds != null || block.dels != null ? (
          <span className="ac-mono flex-none text-nano">
            {block.adds != null ? <span className="text-done">+{block.adds}</span> : null}
            {block.dels != null ? <span className="text-failed"> −{block.dels}</span> : null}
          </span>
        ) : block.durationMs != null ? (
          <span className="ac-mono flex-none text-nano text-text-4">{fmtDuration(block.durationMs)}</span>
        ) : null}
      </div>
      {block.diff ? <ResultLines text={block.diff} /> : null}
    </div>
  );
}

/** A tool's result body, one line per line, indented two spaces under its call. */
function ResultLines({ text }: { text: string }): React.ReactElement {
  return (
    <div className="flex flex-col" data-trace-result style={{ paddingLeft: '2ch' }}>
      {text.split('\n').map((line, i) => (
        <span
          key={i}
          className={cx(
            'ac-mono whitespace-pre-wrap text-nano',
            line.startsWith('+') ? 'text-done' : line.startsWith('-') ? 'text-failed' : 'text-text-4',
          )}
        >
          {line || ' '}
        </span>
      ))}
    </div>
  );
}

function ToolGroup({ row }: { row: Extract<TranscriptRow, { type: 'tools' }> }): React.ReactElement {
  return (
    <div className="flex flex-col gap-1 border-l border-line-2 pl-2.5" data-trace-tool-group>
      <div className="flex items-center gap-2">
        <span className="ac-mono flex-none text-nano text-text-4">▾</span>
        <span className="ac-mono text-nano text-text-2">{row.tool} ×{row.calls.length}</span>
      </div>
      <div className="flex flex-col gap-1">
        {row.calls.map((c) => (
          <ToolRow key={c.id} block={c} marker="·" />
        ))}
      </div>
    </div>
  );
}

function TraceLine({ block }: { block: TranscriptBlock }): React.ReactElement {
  // Narration — and a runtime's own thinking — reads as work in progress, not as something addressed
  // to the human: italic, in the dimmest ink (HANDOFF §5).
  if (block.type === 'text') {
    return (
      <div data-trace-narration={block.thinking ? 'thinking' : 'text'} className="text-nano italic leading-relaxed text-text-4">
        <Markdown source={block.text} className="text-nano italic text-text-4" />
      </div>
    );
  }
  if (block.type === 'tool') return <ToolRow block={block} />;
  if (block.type === 'phase') {
    return (
      <div className="ac-mono text-nano text-text-4" data-trace-phase>
        phase: {block.phase}
        {block.durationMs != null ? ` · ${fmtDuration(block.durationMs)}` : ''}
        {block.tokens != null ? ` · ${fmtTokens(block.tokens)} tok` : ''}
      </div>
    );
  }
  if (block.type === 'status') {
    return <div className="ac-mono text-nano text-text-4" data-trace-status>{block.text}</div>;
  }
  if (block.type === 'report') {
    return <div className="ac-mono text-nano text-text-3" data-trace-report>{block.report.summary}</div>;
  }
  if (block.type === 'command') {
    return (
      <div className="flex flex-col gap-0.5">
        <div className="flex items-center gap-2" data-trace-tool>
          <span className="ac-mono flex-none text-nano text-text-4">$</span>
          <span className="ac-mono min-w-0 flex-1 truncate text-nano text-text-2">{block.command}</span>
          {block.exitCode != null ? <span className={cx('ac-mono text-nano', block.exitCode === 0 ? 'text-done' : 'text-failed')}>exit {block.exitCode}</span> : null}
        </div>
        {block.output ? <ResultLines text={block.output} /> : null}
      </div>
    );
  }
  // human
  return <div className="ac-mono text-nano text-text-4" data-trace-human>→ you: {block.text}</div>;
}

/** The collapsed summary line's parts, in the order they answer "what did it do?" — a zero or an
 *  unreported quantity is left out, never printed as `0 tok` (VS-204). */
function summaryParts(trace: RunTrace, contextWindowTokens: number | null | undefined, compactionAt: number | null | undefined): string[] {
  const out: string[] = [];
  if (trace.toolCalls) out.push(`${trace.toolCalls} tool call${trace.toolCalls === 1 ? '' : 's'}`);
  if (trace.files) out.push(`${trace.files} file${trace.files === 1 ? '' : 's'}`);
  if (trace.errors) out.push(`${trace.errors} error${trace.errors === 1 ? '' : 's'}`);
  if (trace.durationMs != null) out.push(fmtDuration(trace.durationMs));
  const spent = trace.usage ? trace.usage.inputTokens + trace.usage.outputTokens : null;
  if (spent != null) out.push(`${fmtTokens(spent)} tok`);
  const context = contextStrip({ usage: trace.usage, contextWindowTokens, compactionAt, hasRun: trace.finishedAt != null });
  if (context && !context.reason) out.push(`${context.tokensLabel}/${context.windowLabel} ctx`);
  return out;
}

/**
 * A finished turn under the message it produced: the collapsed summary line, opening to the turn's
 * trace. The events are read only once the line is opened, so a history of turns is a history of
 * lines (VS-74).
 */
export function ChatTurnTrace({
  trace,
  contextWindowTokens,
  compactionAt,
}: {
  trace: RunTrace;
  contextWindowTokens?: number | null;
  compactionAt?: number | null;
}): React.ReactElement {
  const [open, setOpen] = useState(false);
  const events = useRunEvents(open ? trace.runId : '', 0, undefined, { newest: true });
  const failed = trace.errors > 0 || trace.status === 'failed';
  const parts = summaryParts(trace, contextWindowTokens, compactionAt);
  return (
    <div className="flex flex-col gap-1" data-chat-summary>
      <button type="button" aria-expanded={open} aria-label="What the weaver did" onClick={() => setOpen((v) => !v)} className="flex items-center gap-2 self-start text-left">
        <span className="ac-mono text-nano text-text-4">{open ? '▾' : '▸'}</span>
        <span className={cx('ac-mono text-nano', failed ? 'text-failed' : 'text-text-4')}>weaver did</span>
        <span className="ac-mono min-w-0 flex-1 truncate text-nano text-text-4">{parts.join(' · ')}</span>
      </button>
      {open ? <ChatTrace events={events.data ?? []} className="mt-1 border-l border-line-1 pl-2.5" /> : null}
    </div>
  );
}
