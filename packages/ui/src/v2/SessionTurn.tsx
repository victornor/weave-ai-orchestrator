/**
 * One turn of a persistent session, rendered as the raw session (VS-618).
 *
 * The turn is its run's own transcript: the assistant's text as it was written, each tool call and
 * its result, `edit`/`write` diffs, written-file previews and command rows, through the shared
 * `Transcript` renderer. `LivePartials` and `LiveActivity` are the pieces `RunTranscript` adds while
 * a run is live. There is deliberately no scroll box: the session conversation scrolls as one page
 * (VS-616), so a second scroller is the wrong shape.
 *
 * The conversation does not render the engine's delivered copy of the turn's final text — its words
 * are in the transcript. A runtime that reported its final text outside the recorded event stream
 * would otherwise lose it, so when a finished turn's transcript carries no assistant text and an
 * answer was delivered, that answer renders here as the turn's closing text: once, never twice.
 */
import type { Run } from '@weave-ai/shared';
import { isActiveRun } from '@weave-ai/shared';
import { useRunEventStream } from '../api/runStream';
import { Transcript } from '../components/Transcript';
import { LiveActivity, LivePartials } from '../components/LiveActivity';
import { Markdown } from '../components/Markdown';

export function SessionTurn({ run, deliveredText, onTicket }: { run: Run; deliveredText?: string | null; onTicket?: (id: string) => void }): React.ReactElement {
  const live = isActiveRun(run.status);
  const stream = useRunEventStream(run.id, { live, newest: !live });
  const { events, partials, lastPartialAt, partialSince } = stream;
  const hasText = events.some((e) => e.type === 'assistant.text');
  return (
    <div data-session-turn={run.id} className="flex flex-col gap-2">
      {events.length > 0 ? <Transcript events={events} onTicket={onTicket} /> : null}
      {live ? (
        <div className="flex flex-col gap-2">
          <LivePartials partials={partials} onTicket={onTicket} />
          <LiveActivity events={events} partials={partials} lastPartialAt={lastPartialAt} partialSince={partialSince} runtimeId={run.runtimeId} />
        </div>
      ) : null}
      {!live && !hasText && deliveredText ? (
        <Markdown source={deliveredText} onTicket={onTicket} breaks className="text-body leading-relaxed text-text-body" />
      ) : null}
    </div>
  );
}
