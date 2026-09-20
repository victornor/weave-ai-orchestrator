/**
 * One run's live turn as a conversation surface shows it (VS-616): the streaming text and reasoning
 * still being generated, each tool call and its result as it arrives, and the live activity row.
 *
 * One composition, shared by the weaver and planner chats (`ChatConversation`) and a persistent
 * session's thread feed, so the three read identically and cannot drift. `showOutput` gates the
 * streamed text and the trace — the weaver chat's device switch, off by default — while the activity
 * row always renders, so an interface that hides the stream still says what the agent is doing.
 *
 * The streamed output sits in a container labelled as in-progress run output, never a delivered
 * message: that is the visible half of the rule that streamed weaver text reaches a human only
 * through `weave_human_send`.
 */
import type { RunEvent } from '@weave-ai/shared';
import { LiveActivity, LivePartials } from '../components/LiveActivity';
import type { PartialText } from '../lib/livePartials';
import { cx } from '../lib/cx';
import { ChatTrace } from './ChatTrace';

export interface LiveTurnSectionProps {
  events: readonly RunEvent[];
  partials?: readonly PartialText[];
  lastPartialAt?: number | null;
  partialSince?: number | null;
  /** The run's runtime, so the activity row resolves whether the runtime can stream (VS-599). */
  runtimeId?: string | null;
  /** Scopes the trace's reveal baseline to this run (VS-440). */
  runId?: string | null;
  /** Whether the streamed text and the mid-turn tool trace render; the activity row always does. */
  showOutput?: boolean;
  /** Whether trace lines reveal in as they arrive (a run this surface watched begin). */
  reveal?: boolean;
  /**
   * Whether an empty trace mounts before its first event, so that first line streams (VS-440). Only
   * for a run the surface saw begin; a mid-turn join leaves it false so the lines already on the wire
   * render whole.
   */
  mountTrace?: boolean;
  /** Ticket identifiers in streamed text and trace narration become tags that call this (VS-623). */
  onTicket?: (id: string) => void;
  className?: string;
}

export function LiveTurnSection({
  events,
  partials = [],
  lastPartialAt = null,
  partialSince = null,
  runtimeId,
  runId = null,
  showOutput = true,
  reveal = true,
  mountTrace = false,
  onTicket,
  className,
}: LiveTurnSectionProps): React.ReactElement {
  return (
    <div data-live-turn-section className={cx('flex flex-col gap-2', className)}>
      {showOutput ? (
        <div data-live-run-view className="flex flex-col gap-2 rounded-r4 border border-line-1 bg-bg-0/40 px-2.5 py-2">
          <p data-live-run-view-label className="ac-label flex items-center gap-1.5 text-text-4">
            <span aria-hidden className="size-1.5 flex-none rounded-pill bg-working motion-safe:animate-[ac-pulse_1.6s_ease-in-out_infinite]" />
            Live run output — not sent yet
          </p>
          <LivePartials partials={partials} onTicket={onTicket} />
          {events.length > 0 || mountTrace ? <ChatTrace events={events} runId={runId} onTicket={onTicket} className="border-l border-line-1 pl-2.5" reveal={reveal} /> : null}
        </div>
      ) : null}
      <LiveActivity events={events} partials={partials} lastPartialAt={lastPartialAt} partialSince={partialSince} runtimeId={runtimeId} />
    </div>
  );
}