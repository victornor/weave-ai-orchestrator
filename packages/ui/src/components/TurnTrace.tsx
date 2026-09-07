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
import type { RunTrace } from '@agent-conductor/shared';
import { RunTranscript } from './RunTranscript';
import { useRunEvents } from '../api/hooks';
import { clock, duration } from '../lib/format';
import { cx } from '../lib/cx';

/** The counts worth saying, in the order they answer "what did it do?". A zero is left out. */
function parts(trace: RunTrace): string[] {
  const out: string[] = [];
  if (trace.toolCalls) out.push(`${trace.toolCalls} tool call${trace.toolCalls === 1 ? '' : 's'}`);
  if (trace.files) out.push(`${trace.files} file${trace.files === 1 ? '' : 's'}`);
  if (trace.errors) out.push(`${trace.errors} error${trace.errors === 1 ? '' : 's'}`);
  if (trace.durationMs != null) out.push(duration(trace.durationMs));
  return out;
}

export function TurnTrace({
  trace,
  open,
  onToggle,
  standalone = false,
}: {
  trace: RunTrace;
  open: boolean;
  onToggle: () => void;
  standalone?: boolean;
}): React.ReactElement {
  // Disabled until it is opened: this is the whole of "loaded on demand". A closed trace never
  // reaches the daemon, and re-opening one reads the events react-query already holds.
  const events = useRunEvents(open ? trace.runId : '');
  const label = parts(trace);
  const failed = trace.errors > 0 || trace.status === 'failed';

  return (
    <div className={cx('flex flex-col gap-1.5', standalone && 'border-l-2 border-line-1 pl-2.5')}>
      <button
        type="button"
        aria-expanded={open}
        aria-label={standalone ? `What the conductor did at ${clock(trace.finishedAt ?? trace.createdAt)}` : 'What I did'}
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
          <RunTranscript events={events.data ?? []} label={`What the conductor did in run ${trace.runId}`} />
        </div>
      ) : null}
    </div>
  );
}
