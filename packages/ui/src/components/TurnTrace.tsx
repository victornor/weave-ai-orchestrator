/**
 * What a finished conductor turn did, kept in the chat under the reply it produced (VS-74).
 *
 * The live stream is the turn as it happens; this is the same turn afterwards, folded down to one
 * line. Collapsed it costs nothing — the counts come from the run's trace summary, which the chat
 * already has for the whole page — and the events are asked for only once the human opens it, so a
 * history of forty turns is forty lines rather than forty transcripts.
 *
 * `standalone` is the turn that said nothing: same trace, no reply above it, so the row carries the
 * time and the run's own summary that a reply would otherwise have supplied.
 */
import type { RunTrace } from '@weave-ai/shared';
import { contextStrip } from '@weave-ai/render';
import { RunTranscript } from './RunTranscript';
import { useRunEvents } from '../api/hooks';
import { clock, duration, tokens } from '../lib/format';
import { cx } from '../lib/cx';

/** The turn's own tokens spent, or null when its runtime reported none (VS-204). */
function turnTokens(usage: RunTrace['usage']): number | null {
  return usage ? usage.inputTokens + usage.outputTokens : null;
}

/**
 * The counts worth saying, in the order they answer "what did it do?". A zero is left out, and so
 * is a quantity a runtime never reported — never a `0 tok` or a `·` with nothing after it (VS-204).
 */
function parts(trace: RunTrace, contextWindowTokens: number | null | undefined, compactionAt: number | null | undefined): string[] {
  const out: string[] = [];
  if (trace.toolCalls) out.push(`${trace.toolCalls} tool call${trace.toolCalls === 1 ? '' : 's'}`);
  if (trace.files) out.push(`${trace.files} file${trace.files === 1 ? '' : 's'}`);
  if (trace.errors) out.push(`${trace.errors} error${trace.errors === 1 ? '' : 's'}`);
  if (trace.durationMs != null) out.push(duration(trace.durationMs));
  const spent = turnTokens(trace.usage);
  if (spent != null) out.push(`${tokens(spent)} tok`);
  // A size over the window, never a bare percentage of it: the header context meter avoids that
  // for the same reason (VS-129) - a declared window that is wrong reads as a size over 100%,
  // which a percentage alone would hide.
  const context = contextStrip({ usage: trace.usage, contextWindowTokens, compactionAt, hasRun: trace.finishedAt != null });
  if (context && !context.reason) out.push(`${context.tokensLabel}/${context.windowLabel} ctx`);
  return out;
}

export function TurnTrace({
  trace,
  open,
  onToggle,
  standalone = false,
  contextWindowTokens,
  compactionAt,
}: {
  trace: RunTrace;
  open: boolean;
  onToggle: () => void;
  standalone?: boolean;
  /** The turn's own model's context window, from the runtime's model list. Omit when unresolvable. */
  contextWindowTokens?: number | null;
  /** The runtime's compaction point as a fraction of the window, from its capabilities. */
  compactionAt?: number | null;
}): React.ReactElement {
  // Disabled until it is opened: this is the whole of "loaded on demand". A closed trace never
  // reaches the daemon, and re-opening one reads the events react-query already holds.
  const events = useRunEvents(open ? trace.runId : '');
  const label = parts(trace, contextWindowTokens, compactionAt);
  const failed = trace.errors > 0 || trace.status === 'failed';

  return (
    <div className={cx('flex flex-col gap-1.5', standalone && 'border-l-2 border-line-1 pl-2.5')}>
      <button
        type="button"
        aria-expanded={open}
        aria-label={standalone ? `What the weaver did at ${clock(trace.finishedAt ?? trace.createdAt)}` : 'What I did'}
        onClick={onToggle}
        // `py-1.5` and the full-width hit area are the phone affordance: the row is the control.
        className="-mx-1 flex items-center gap-2 rounded-r4 px-1 py-1.5 text-left hover:bg-bg-2"
      >
        <span className="ac-mono text-nano text-text-4">{open ? '▾' : '▸'}</span>
        <span className={cx('ac-mono text-nano', failed ? 'text-failed' : 'text-text-4')}>
          {standalone ? 'worked' : 'what I did'}
        </span>
        <span className="ac-mono ac-truncate min-w-0 flex-1 text-nano text-text-4">{label.join(' · ')}</span>
        {standalone ? <span className="ac-mono flex-none text-nano text-text-4">{clock(trace.finishedAt ?? trace.createdAt)}</span> : null}
      </button>
      {standalone && trace.summary ? <p className="text-micro leading-relaxed text-text-3">{trace.summary}</p> : null}
      {open ? (
        <div className="ac-card overflow-hidden">
          <RunTranscript events={events.data ?? []} label={`What the weaver did in run ${trace.runId}`} />
        </div>
      ) : null}
    </div>
  );
}
