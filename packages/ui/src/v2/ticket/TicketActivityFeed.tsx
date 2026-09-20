/**
 * A ticket's activity feed: its comments and each run's transcript, interleaved in time (VS-346,
 * VS-623). Extracted from the ticket page's Activity pane so the ticket modal shows the same feed,
 * not a second view; both pass the one `onTicket` their surface uses.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { isActiveRun, type Run, type Ticket } from '@weave-ai/shared';
import { useTicketComments, useTicketRuns } from '../../api/hooks';
import { useRunEventStream } from '../../api/runStream';
import { EmptyState } from '../../components/States';
import { SkeletonRows } from '../../components/Skeleton';
import { StatusGlyph } from '../../components/StatusGlyph';
import { Badge } from '../../components/StatusGlyph';
import { Markdown } from '../../components/Markdown';
import { RunTranscript } from '../../components/RunTranscript';
import { ago } from '../../lib/format';
import { cx } from '../../lib/cx';

/** One run of the ticket, its transcript opened when it is the live one (VS-346). */
export function RunTurn({ run, onTicket }: { run: Run; onTicket?: (id: string) => void }): React.ReactElement {
  const live = isActiveRun(run.status);
  const [open, setOpen] = useState(live);
  const wasLive = useRef(live);
  useEffect(() => {
    if (wasLive.current !== live) setOpen(live);
    wasLive.current = live;
  }, [live]);
  const stream = useRunEventStream(open ? run.id : null, { live });
  const { events } = stream;
  const at = run.finishedAt ?? run.startedAt ?? run.createdAt;
  const status = run.status === 'running' ? 'working' : run.status === 'succeeded' ? 'done' : run.status === 'interrupted' || run.status === 'cancelled' ? 'paused' : 'failed';
  return (
    <div className="flex items-start gap-2.5 px-1 py-1">
      <StatusGlyph status={status} size="xs" pulse={live} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2 text-micro text-text-3">
          <span>turn {run.turnEpoch}</span>
          <span>·</span>
          <span>{run.status}</span>
          <span>·</span>
          <span className="ac-mono">{ago(at)}</span>
          <div className="flex-1" />
          <button type="button" aria-expanded={open} onClick={() => setOpen((v) => !v)} className="rounded-r4 px-1.5 py-0.5 text-nano text-text-4 hover:bg-bg-3 hover:text-text-1">
            {open ? 'hide transcript' : 'show transcript'}
          </button>
        </div>
        {run.summary ? <p className="mt-0.5 text-meta leading-relaxed text-text-body">{run.summary}</p> : null}
        {open ? (
          <div className="v2-anim-fade v2-card mt-2 overflow-hidden">
            <RunTranscript events={events} live={live} stream={stream} runtimeId={run.runtimeId} label={`Transcript of turn ${run.turnEpoch}`} onTicket={onTicket} />
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function TicketActivityFeed({ ticket, workerName, onTicket }: { ticket: Ticket; workerName: string | null; onTicket?: (id: string) => void }): React.ReactElement {
  const comments = useTicketComments(ticket.id);
  const runs = useTicketRuns(ticket.id);
  const feed = useMemo(() => {
    const items: Array<{ at: string; key: string; node: React.ReactNode }> = [];
    for (const c of comments.data ?? []) {
      items.push({
        at: c.createdAt,
        key: `c-${c.id}`,
        node: (
          <article className={cx('v2-card p-3.5', c.authorKind === 'human' && 'border-accent-edge')}>
            <div className="mb-1.5 flex items-center gap-2">
              <span className="text-micro font-medium text-text-soft">
                {c.authorKind === 'human' ? 'You' : c.authorKind === 'agent' ? (workerName ?? 'Worker') : 'System'}
              </span>
              {c.kind !== 'comment' ? <Badge>{c.kind}</Badge> : null}
              <div className="flex-1" />
              <span className="ac-mono text-nano text-text-4">{ago(c.createdAt)}</span>
            </div>
            <Markdown source={c.body} breaks />
          </article>
        ),
      });
    }
    for (const r of runs.data ?? []) {
      items.push({ at: r.finishedAt ?? r.startedAt ?? r.createdAt, key: `r-${r.id}`, node: <RunTurn run={r} onTicket={onTicket} /> });
    }
    return items.sort((a, b) => a.at.localeCompare(b.at));
  }, [comments.data, runs.data, workerName, onTicket]);

  if (comments.isLoading || runs.isLoading) return <SkeletonRows rows={4} />;
  if (feed.length === 0) {
    return <EmptyState title="Nothing has happened yet." detail="Your replies, the worker's messages and its turns land here, in order." />;
  }
  return (
    <div className="flex flex-col gap-3" data-ticket-activity-feed>
      {feed.map((f) => (
        <div key={f.key}>{f.node}</div>
      ))}
    </div>
  );
}
