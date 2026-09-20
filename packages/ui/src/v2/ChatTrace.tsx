/**
 * The V2 chat trace (web-v2/chat).
 *
 * The run-events view model (`runEventsToTranscript` + `groupConsecutiveTools`, VS-319) rendered in
 * V2's Mono language: narration between tool calls is italic in a dimmer ink, a tool row names the
 * tool and its argument, and a tool's result lines sit behind the call that produced them. Text
 * blocks keep markdown. This is Chat's inline trace; VS-345's `WorkerFeed` is the bounded feed for
 * cards and Live.
 *
 * Density follows V1 (VS-370): a run of same-name calls collapses to one `tool ×N` line that opens
 * to its calls, each call keeps its result behind its own disclosure, and any result or command
 * output longer than a few lines scrolls inside a capped box instead of pushing the conversation.
 *
 * Edits and writes are the exception (VS-413): like V1, an edit-type call shows its diff expanded on
 * first render — that is the thing the human came to read — while every other tool call stays
 * collapsed. An `editPayload` block is never folded into a group, so a diff is never two clicks
 * deep.
 */
import { useEffect, useMemo, useState } from 'react';
import type { RunEvent, RunTrace } from '@weave-ai/shared';
import { contextStrip } from '@weave-ai/render';
import { groupConsecutiveTools, runEventsToTranscript, targetBaseName } from '../lib/transcript';
import type { ToolBlock, TranscriptBlock, TranscriptRow } from '../lib/transcript';
import { Markdown } from '../components/Markdown';
import { EditPayloadBody } from '../components/Transcript';
import { useRunEvents } from '../api/hooks';
import { readExpandedTraces, toggleExpandedTrace } from '../lib/traceExpansion';
import { duration as fmtDuration, tokens as fmtTokens } from '../lib/format';
import { useNewLiveIds, useStreamReveal } from '../lib/streamReveal';
import { cx } from '../lib/cx';

/** Nothing to animate, shared so a history trace never allocates a set it will not read. */
const NO_REVEAL: ReadonlySet<string> = new Set();

/**
 * VS-454: the live "Compacting conversation…" row, shown while the runtime is compacting and there
 * is no completion yet. Matches the composer's listening state — a pulsing accent dot and a mono
 * label — so a long compaction pause reads as work rather than a stuck weaver. Exported so the
 * screenshot harness and tests render the real component, never a copy.
 */
export function CompactionRow(): React.ReactElement {
  return (
    <div className="flex items-center gap-2" data-v2-compacting>
      <span className="size-1.5 flex-none animate-pulse rounded-full bg-accent-link" aria-hidden />
      <span className="ac-mono text-nano text-text-3">Compacting conversation…</span>
    </div>
  );
}

/**
 * The one piece of variable text a line streams in when it first appears (VS-433): a narration's
 * body, a tool row's argument, a status line, a command. Used only for the reveal; the rendered
 * branches read their own fields.
 */
function lineText(block: TranscriptBlock): string {
  switch (block.type) {
    case 'text': return block.text;
    case 'tool': return block.target;
    case 'phase': return block.phase;
    case 'status': return block.text;
    case 'report': return block.report.summary;
    case 'command': return block.command;
    case 'human': return block.text;
    case 'compaction': return block.text;
  }
}

export function ChatTrace({ events, className, reveal = false, runId = null, onTicket }: { events: readonly RunEvent[]; className?: string; reveal?: boolean; runId?: string | null; onTicket?: (id: string) => void }): React.ReactElement {
  const rows = useMemo(() => groupConsecutiveTools(runEventsToTranscript(events)), [events]);
  // Only a line whose event arrived after this trace started watching the run streams in (VS-433);
  // a history read back or a join mid-turn is the baseline. The run id scopes that baseline (VS-440)
  // and `ChatTurnTrace` never passes `reveal` at all.
  const newIds = useNewLiveIds(events, runId);
  const animate = reveal ? newIds : NO_REVEAL;
  if (rows.length === 0) {
    // The live trace mounts before its first event, so that first line streams (VS-440); with
    // nothing yet on the wire it shows nothing, unlike a history turn that genuinely produced none.
    if (reveal) return <div className={cx('flex flex-col gap-1.5', className)} data-v2-trace />;
    return <p className={cx('text-nano text-text-4', className)}>Nothing on the wire yet.</p>;
  }
  return (
    <div className={cx('flex flex-col gap-1.5', className)} data-v2-trace>
      {rows.map((row) =>
        row.type === 'tools' ? (
          <ToolGroup key={row.id} row={row} />
        ) : row.block.type === 'tool' ? (
          <ToolRow key={row.block.id} block={row.block} reveal={animate.has(row.block.id)} />
        ) : (
          <TraceLine key={row.block.id} block={row.block} reveal={animate.has(row.block.id)} onTicket={onTicket} />
        ),
      )}
    </div>
  );
}

/** The tool's argument, or the tail of its result body when there is no separate argument. A call
 *  whose result is text, or an edit whose payload carries a diff, keeps that body behind a
 *  disclosure; a call with nothing to show is one line, never a button that opens onto nothing. */
function ToolRow({ block, marker = '▸', reveal = false }: { block: ToolBlock; marker?: string; reveal?: boolean }): React.ReactElement {
  // An edit or write starts expanded (VS-413), mirroring V1's `TranscriptLine`: the diff is the
  // content the human asked for, not a second click to reveal it. Every other tool row — reads,
  // searches, shell output — keeps starting collapsed (VS-370).
  const [open, setOpen] = useState(() => Boolean(block.editPayload));
  const expandable = Boolean(block.diff) || Boolean(block.editPayload);
  // A file tool shows only the file name (VS-437); the whole path stays on the element as a title.
  // A command, a pattern or a url has no `targetPath` and renders exactly as it always did.
  const targetLabel = block.targetPath ? targetBaseName(block.targetPath) : block.target;
  // The argument streams in when the row is new (VS-433); the tool name is its fixed label. It is
  // the label (VS-437) that streams, not the raw target — a new file row reveals `MEMORY.md`.
  const target = useStreamReveal(targetLabel, reveal);
  const tone = block.denied ? 'text-needs-you' : block.error ? 'text-failed' : 'text-text-2';
  const head = (
    <div className="flex items-center gap-2" data-trace-tool>
      <span className="ac-mono flex-none text-nano text-text-4">{expandable ? (open ? '▾' : '▸') : marker}</span>
      <span className={cx('ac-mono flex-none text-nano', tone)}>{block.tool}</span>
      {targetLabel ? <span className="ac-mono min-w-0 flex-1 truncate text-nano text-text-3" title={block.targetPath ?? undefined}>{target}</span> : <span className="flex-1" />}
      {block.adds != null || block.dels != null ? (
        <span className="ac-mono flex-none text-nano">
          {block.adds != null ? <span className="text-done">+{block.adds}</span> : null}
          {block.dels != null ? <span className="text-failed"> −{block.dels}</span> : null}
        </span>
      ) : block.durationMs != null ? (
        <span className="ac-mono flex-none text-nano text-text-4">{fmtDuration(block.durationMs)}</span>
      ) : null}
    </div>
  );
  return (
    <div className="flex flex-col gap-0.5">
      {expandable ? (
        <button
          type="button"
          aria-expanded={open}
          aria-label={`${block.tool}${block.target ? `, ${block.target}` : ''}`}
          onClick={() => setOpen((v) => !v)}
          className="text-left"
        >
          {head}
        </button>
      ) : (
        head
      )}
      {open && block.editPayload ? (
        // The edit/write body comes straight from V1's `EditPayloadBody` (VS-324): the same
        // `diffHunksForEdits` derivation, `DiffHunks` and 40-line window, not a second renderer.
        <div className="v2-anim-fade ac-scroll max-h-96 overflow-auto" data-trace-edit>
          <EditPayloadBody id={block.id} path={block.target} payload={block.editPayload} />
        </div>
      ) : open && block.diff ? (
        <ResultLines text={block.diff} />
      ) : null}
    </div>
  );
}

/** A tool's result body, one line per line, indented two spaces under its call and bounded so a long
 *  result scrolls rather than dragging the conversation down with it. */
function ResultLines({ text }: { text: string }): React.ReactElement {
  return (
    <div className="v2-anim-fade ac-scroll flex max-h-40 flex-col overflow-auto" data-trace-result style={{ paddingLeft: '2ch' }}>
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

/** A run of same-name calls, collapsed to one counted line. Opening it lists the calls; each call's
 *  own result stays behind that call's disclosure. State is local and keyed by the group's first
 *  call, so an opened group stays open as live events arrive and a closed one stays closed. */
function ToolGroup({ row }: { row: Extract<TranscriptRow, { type: 'tools' }> }): React.ReactElement {
  const [open, setOpen] = useState(false);
  const n = row.calls.length;
  return (
    <div className="flex flex-col gap-1 border-l border-line-2 pl-2.5" data-trace-tool-group>
      <button
        type="button"
        aria-expanded={open}
        aria-label={`${row.tool}, ${n} calls`}
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 text-left"
      >
        <span className="ac-mono flex-none text-nano text-text-4">{open ? '▾' : '▸'}</span>
        <span className="ac-mono text-nano text-text-2">{row.tool} ×{n}</span>
      </button>
      {open ? (
        <div className="v2-anim-fade flex flex-col gap-1">
          {row.calls.map((c) => (
            <ToolRow key={c.id} block={c} marker="·" />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function TraceLine({ block, reveal, onTicket }: { block: TranscriptBlock; reveal: boolean; onTicket?: (id: string) => void }): React.ReactElement {
  const text = useStreamReveal(lineText(block), reveal);
  // Narration — and a runtime's own thinking — reads as work in progress, not as something addressed
  // to the human: italic, in the dimmest ink (HANDOFF §5).
  if (block.type === 'text') {
    return (
      <div data-trace-narration={block.thinking ? 'thinking' : 'text'} className="text-nano italic leading-relaxed text-text-4">
        <Markdown source={text} onTicket={onTicket} className="text-nano italic text-text-4" />
      </div>
    );
  }
  if (block.type === 'tool') return <ToolRow block={block} reveal={reveal} />;
  if (block.type === 'phase') {
    return (
      <div className="ac-mono text-nano text-text-4" data-trace-phase>
        phase: {text}
        {block.durationMs != null ? ` · ${fmtDuration(block.durationMs)}` : ''}
        {block.tokens != null ? ` · ${fmtTokens(block.tokens)} tok` : ''}
      </div>
    );
  }
  if (block.type === 'status') {
    return <div className="ac-mono text-nano text-text-4" data-trace-status>{text}</div>;
  }
  if (block.type === 'compaction') {
    // VS-454: the finished-turn marker that explains a context-meter drop. Quieter than a status
    // line's ink so it reads as a note about the conversation, not a thing the weaver did.
    return <div className="ac-mono text-nano text-text-4" data-trace-compaction>{text}</div>;
  }
  if (block.type === 'report') {
    return <div className="ac-mono text-nano text-text-3" data-trace-report>{text}</div>;
  }
  if (block.type === 'command') {
    return (
      <div className="flex flex-col gap-0.5">
        <div className="flex items-center gap-2" data-trace-tool>
          <span className="ac-mono flex-none text-nano text-text-4">$</span>
          <span className="ac-mono min-w-0 flex-1 truncate text-nano text-text-2">{text}</span>
          {block.exitCode != null ? <span className={cx('ac-mono text-nano', block.exitCode === 0 ? 'text-done' : 'text-failed')}>exit {block.exitCode}</span> : null}
        </div>
        {block.output ? <ResultLines text={block.output} /> : null}
      </div>
    );
  }
  // human
  return <div className="ac-mono text-nano text-text-4" data-trace-human>→ you: {text}</div>;
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
 * lines (VS-74), and which turns are open is remembered per workspace for the browsing session the
 * way V1's `TurnTrace` remembers it (`lib/traceExpansion.ts`).
 */
export function ChatTurnTrace({
  trace,
  ws,
  actorName = 'weaver',
  contextWindowTokens,
  compactionAt,
  onTicket,
}: {
  trace: RunTrace;
  /** The workspace the remembered expansion set is scoped to. */
  ws: string;
  /** Who did the turn, named in the collapsed summary ("weaver" / "Planner"). */
  actorName?: string;
  contextWindowTokens?: number | null;
  compactionAt?: number | null;
  /** Ticket identifiers in the opened trace's narration become tags that call this (VS-623). */
  onTicket?: (id: string) => void;
}): React.ReactElement {
  const [expanded, setExpanded] = useState<string[]>(() => readExpandedTraces(ws));
  useEffect(() => setExpanded(readExpandedTraces(ws)), [ws]);
  const open = expanded.includes(trace.runId);
  const events = useRunEvents(open ? trace.runId : '', 0, undefined, { newest: true });
  const failed = trace.errors > 0 || trace.status === 'failed';
  const parts = summaryParts(trace, contextWindowTokens, compactionAt);
  return (
    <div className="flex flex-col gap-1" data-chat-summary>
      <button
        type="button"
        aria-expanded={open}
        aria-label={`What the ${actorName} did`}
        onClick={() => setExpanded(toggleExpandedTrace(ws, trace.runId))}
        className="flex items-center gap-2 self-start text-left"
      >
        <span className="ac-mono text-nano text-text-4">{open ? '▾' : '▸'}</span>
        <span className={cx('ac-mono text-nano', failed ? 'text-failed' : 'text-text-4')}>{actorName} did</span>
        <span className="ac-mono min-w-0 flex-1 truncate text-nano text-text-4">{parts.join(' · ')}</span>
      </button>
      {open ? <ChatTrace events={events.data ?? []} onTicket={onTicket} className="v2-anim-fade mt-1 border-l border-line-1 pl-2.5" /> : null}
    </div>
  );
}
