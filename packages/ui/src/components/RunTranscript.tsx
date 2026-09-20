/**
 * One run's transcript in a box that scrolls itself.
 *
 * The chat streams its turn into the page's own scroller, because the turn *is* the page. Every
 * other surface showing a transcript has something around it worth keeping still — the ticket's
 * feed of comments and turns, the Run page's tiles and phase timings — so the transcript is bounded
 * and follows its own bottom instead of dragging the page down with each event.
 *
 * `live` is the run's own state, not a preference: a running turn follows its newest line and shows
 * the scroll-to-bottom button when the human reads back through it, and a finished one opens where
 * it starts and stays there.
 */
import { Transcript } from './Transcript';
import { ScrollToBottomButton } from './ScrollToBottom';
import { useStickToBottom } from '../lib/stickToBottom';
import { cx } from '../lib/cx';
import { LiveActivity, LivePartials, type LiveRunProps } from './LiveActivity';
import type { RunEvent } from '@weave-ai/shared';

export function RunTranscript({
  events,
  live = false,
  follow,
  label,
  height,
  maxHeight,
  className,
  stream,
  runtimeId,
}: {
  events: readonly RunEvent[];
  /** VS-595: the run's partial output; with `live`, the activity row and the streaming text render. */
  stream?: Pick<LiveRunProps, 'partials' | 'lastPartialAt' | 'partialSince'>;
  runtimeId?: string | null;
  live?: boolean;
  /**
   * Whether the list opens at its newest line and follows new ones, independent of `live`. A pane
   * opened to watch a run passes `true` even once that run has finished, so it opens at the end
   * rather than the start (VS-409); the default is the run's own state.
   */
  follow?: boolean;
  /** Names the region for assistive tech and for the tests that pick one turn out of a feed. */
  label: string;
  /**
   * Bounds the scroller to exactly this many pixels instead of the viewport share (VS-372: Live's
   * dragged tile height). The caller owns the surrounding box, so the transcript fills and scrolls
   * inside it rather than clipping against its own cap.
   */
  height?: number;
  /**
   * The caller's matching `max-height` for a box that shrinks to its content (VS-409): the scroller
   * and its parent then share one height, so the scroll range reaches the last line instead of the
   * transcript growing past the box that is supposed to contain it.
   */
  maxHeight?: number;
  className?: string;
}): React.ReactElement {
  const partials = stream?.partials ?? [];
  const partialChars = partials.reduce((n, p) => n + p.text.length, 0);
  const stick = useStickToBottom([events.length, partialChars], { follow: follow ?? live, contained: true });

  return (
    <div className="relative">
      <div
        ref={stick.scrollRef}
        role="log"
        aria-label={label}
        aria-live={live ? 'polite' : 'off'}
        style={height !== undefined ? { height, maxHeight: 'none' } : maxHeight !== undefined ? { maxHeight } : undefined}
        className={cx('ac-scroll max-h-[calc(var(--ac-app-h)*0.5)] md:max-h-[calc(var(--ac-app-h)*0.6)]', className)}
      >
        {live && events.length === 0 ? null : <Transcript events={events} className="gap-2" />}
        {live ? (
          <div className="flex flex-col gap-2 p-3.5 pt-1">
            <LivePartials partials={partials} />
            <LiveActivity events={events} partials={partials} lastPartialAt={stream?.lastPartialAt ?? null} partialSince={stream?.partialSince ?? null} runtimeId={runtimeId} />
          </div>
        ) : null}
        <div ref={stick.bottomRef} />
      </div>
      {stick.atBottom ? null : <ScrollToBottomButton unread={stick.unread} onClick={stick.toBottom} />}
    </div>
  );
}
