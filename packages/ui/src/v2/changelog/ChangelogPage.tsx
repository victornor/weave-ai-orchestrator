/**
 * V2 Changelog (`/w/:ws/changelog`): the workspace record — a year heatmap above a newest-first
 * timeline, grouped by day, week and month (web-v2/changelog, PLAN §13.6).
 *
 * V1's `ChangelogPanel` (`routes/Changelog.tsx`) is the data reference; this renders its own V2 tree,
 * reusing the shared `groupTimeline` view model (so a heatmap cell and the separator it moves to mean
 * the same day), the `ActivityHeatmap` and the kind vocabulary `KIND_LABEL`.
 */
import { useCallback, useMemo, useRef, useState } from 'react';
import { groupTimeline, type TimelineGroup } from '@weave-ai/render';
import { readerTimezone, useChangelog, useChangelogHeatmap } from '../../api/hooks';
import type { ChangelogEntry } from '../../api/types';
import { ActivityHeatmap } from '../../components/Heatmap';
import { SkeletonRows } from '../../components/Skeleton';
import { EmptyState, ErrorState } from '../../components/States';
import { A } from '../../app/link';
import { useWs } from '../../api/context';
import { cx } from '../../lib/cx';
import { KIND_LABEL } from '../../routes/Changelog';
import { V2Page } from '../V2Page';

const DAY_FMT = new Intl.DateTimeFormat(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const MONTH_FMT = new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' });
const TIME_FMT = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' });

const asDate = (day: string): Date => new Date(`${day}T12:00:00Z`);
const weekLabel = (week: string): string => `Week of ${new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' }).format(asDate(week))}`;

export function V2ChangelogScreen(): React.ReactElement {
  return (
    <V2Page title="Changelog">
      <ChangelogTimeline />
    </V2Page>
  );
}

/**
 * The timeline itself, workspace-wide with no `project`, scoped to one with it. The V2 Changelog
 * screen and the Knowledge screen's Changelog tab (VS-371) both render it, so a change to one is a
 * change to both.
 */
export function ChangelogTimeline({ project }: { project?: string }): React.ReactElement {
  const tz = readerTimezone();
  const history = useChangelog(project);
  const heat = useChangelogHeatmap(project);
  const ws = useWs();
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const [jumping, setJumping] = useState(false);

  const groups = useMemo(() => groupTimeline(history.data ?? [], tz), [history.data, tz]);

  /**
   * A heatmap cell is a day the reader can see but may not have scrolled to. If it is older than
   * everything loaded, page until it is covered and only then scroll — otherwise there is no
   * separator to scroll to.
   */
  const jumpTo = useCallback(async (date: string) => {
    const scroll = (): boolean => {
      const el = bodyRef.current?.querySelector(`[data-day="${date}"]`);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return Boolean(el);
    };
    if (scroll()) return;
    setJumping(true);
    try {
      await history.loadUntil(date);
      requestAnimationFrame(() => { scroll(); });
    } finally {
      setJumping(false);
    }
  }, [history]);

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5 p-4 md:p-5" ref={bodyRef}>
      {history.isLoading ? (
        <SkeletonRows rows={6} />
      ) : history.isError ? (
        <ErrorState code="CHANGELOG_FAILED" message="The changelog could not be read." />
      ) : (
        <>
          {heat.data ? (
            <div className="v2-card p-3.5">
              <ActivityHeatmap heatmap={heat.data} onSelect={(d) => void jumpTo(d)} />
            </div>
          ) : null}

          {!groups.length ? (
            <EmptyState title="Nothing has happened yet." detail="Tickets filed, plans approved, work landed and hires appear here as they happen." />
          ) : (
            <div className="flex flex-col">
              {groups.map((g) => (
                <DayGroup key={g.day} group={g} ws={ws} />
              ))}
            </div>
          )}

          <div className="flex justify-center py-2">
            {jumping || history.isLoadingOlder ? (
              <span className="text-micro text-text-3">Loading older entries…</span>
            ) : history.hasOlder ? (
              <button
                type="button"
                onClick={() => history.loadOlder()}
                className="rounded-r4 border border-line-2 px-3 py-1.5 text-micro text-text-2 hover:bg-bg-2 hover:text-text-1"
              >
                Load older
              </button>
            ) : groups.length ? (
              <span className="text-micro text-text-4">That is the whole record.</span>
            ) : null}
          </div>
        </>
      )}
    </div>
  );
}

function DayGroup({ group, ws }: { group: TimelineGroup; ws: string }): React.ReactElement {
  return (
    <section data-day={group.day} className="scroll-mt-4">
      {group.startsMonth ? (
        <h2 className="mt-6 border-t-2 border-line-2 pt-3 text-body font-medium text-text-1 first:mt-0">
          {MONTH_FMT.format(asDate(group.day))}
        </h2>
      ) : null}
      {group.startsWeek && !group.startsMonth ? (
        <h3 className="mt-5 border-t border-line-2 pt-2.5 text-meta text-text-2">{weekLabel(group.week)}</h3>
      ) : null}
      <h4 className={cx('sticky top-0 z-1 bg-bg-0/90 py-1.5 text-micro text-text-3 backdrop-blur', !group.startsWeek && !group.startsMonth && 'mt-3 border-t border-line-1 pt-2.5')}>
        {DAY_FMT.format(asDate(group.day))}
      </h4>
      <ol className="flex flex-col">
        {group.entries.map((e) => <EntryRow key={e.id} entry={e} ws={ws} />)}
      </ol>
    </section>
  );
}

function EntryRow({ entry, ws }: { entry: ChangelogEntry; ws: string }): React.ReactElement {
  const time = TIME_FMT.format(new Date(entry.at));
  const inner = (
    <>
      <span className="ac-mono w-11 shrink-0 text-nano text-text-4" title={entry.at}>{time}</span>
      <span className="v2-tag shrink-0 text-text-3">{KIND_LABEL[entry.kind]}</span>
      <span className="min-w-0 flex-1 truncate text-meta text-text-1">{entry.summary}</span>
      {entry.ticketIdentifier ? <span className="ac-mono shrink-0 text-nano text-text-3">{entry.ticketIdentifier}</span> : null}
      <span className="ac-mono shrink-0 text-nano text-text-4">{entry.actor.label}</span>
    </>
  );
  const className = 'flex items-center gap-2.5 rounded-r4 px-2 py-1.5 hover:bg-bg-2';

  // A pull request leaves the app; everything else about a ticket goes to the ticket.
  if (entry.link?.kind === 'url') {
    return (
      <li>
        <a href={entry.link.target} target="_blank" rel="noreferrer" className={className} aria-label={`${entry.summary} (opens the pull request)`}>
          {inner}
        </a>
      </li>
    );
  }
  if (entry.link?.kind === 'ticket') {
    return (
      <li>
        <A to="/w/$ws/tickets/$ticketId" params={{ ws, ticketId: entry.link.target }} className={className} aria-label={entry.summary}>
          {inner}
        </A>
      </li>
    );
  }
  return <li className={className}>{inner}</li>;
}
