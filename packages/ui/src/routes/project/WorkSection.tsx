/**
 * The project's unfinished tickets, folded by the board's own columns, each with the worker on it
 * and that worker's last status line (VS-95).
 */
import { useMemo } from 'react';
import { A } from '../../app/link';
import { useRuns, useTickets, useWorkers } from '../../api/hooks';
import { StatusGlyph } from '../../components/StatusGlyph';
import { SkeletonRows } from '../../components/Skeleton';
import { filterTickets, foldBoard, liveWorkersByTicket, pausedWorkersByTicket, ticketBoardStatus } from '../../lib/board';
import { lastLinesByAgent } from '../../lib/projectOverview';
import { ago, statusText } from '../../lib/format';
import { workerPauseReason } from '@weave-ai/render';
import type { ProjectSectionProps } from './sections';

export function WorkSection({ project, ws }: ProjectSectionProps): React.ReactElement {
  const tickets = useTickets({ limit: 300 });
  const workers = useWorkers({});
  // One request covers every live worker's last line; `run.*` already makes it stale.
  const runs = useRuns({ limit: 100 });

  const live = useMemo(() => liveWorkersByTicket(workers.data ?? []), [workers.data]);
  // `paused` is never in `live` (VS-137: a paused worker is, by definition, not live), so a
  // ticket's pause reason needs this separate lookup rather than falling out of the live map.
  const paused = useMemo(() => pausedWorkersByTicket(workers.data ?? []), [workers.data]);
  const lines = useMemo(() => lastLinesByAgent(runs.data ?? []), [runs.data]);
  const columns = useMemo(() => {
    const mine = filterTickets(tickets.data ?? [], { project: project.id }).filter(
      (t) => t.status !== 'done' && t.status !== 'cancelled',
    );
    return foldBoard(mine, live).filter((c) => c.items.length > 0);
  }, [tickets.data, project.id, live]);

  if (tickets.isLoading) return <SkeletonRows rows={3} />;
  if (!columns.length) return <p className="text-meta text-text-3">Nothing is under way in this project.</p>;

  return (
    <div className="flex flex-col gap-3.5">
      {columns.map((c) => (
        <div key={c.key}>
          <div className="ac-label mb-1.5 flex items-center gap-2">
            <StatusGlyph status={c.status} size="xs" />
            {c.label}
            <span className="ac-mono text-nano text-text-4">{c.items.length}</span>
          </div>
          <ul className="flex flex-col gap-1">
            {c.items.map((t) => {
              const worker = live.get(t.id);
              const line = worker ? lines.get(worker.id) : undefined;
              const pausedReason = worker ? null : (() => {
                const p = paused.get(t.id);
                return p ? workerPauseReason(p) : null;
              })();
              return (
                <li key={t.id}>
                  <A
                    to="/w/$ws/tickets/$ticketId"
                    params={{ ws, ticketId: t.identifier }}
                    className="flex flex-col gap-1 rounded-r4 px-1 py-1 hover:bg-bg-2"
                  >
                    <span className="flex items-center gap-2">
                      <StatusGlyph status={ticketBoardStatus(t.status, { live: Boolean(worker) })} size="xs" />
                      <span className="ac-mono flex-none text-nano text-text-3">{t.identifier}</span>
                      <span className="min-w-0 flex-1 truncate text-meta text-text-1">{t.title}</span>
                      <span className="ac-mono flex-none text-nano text-text-4">{ago(t.updatedAt)}</span>
                    </span>
                    <span className="ac-mono flex items-center gap-2 pl-5 text-nano text-text-3">
                      <span>{statusText(t.status)}</span>
                      {worker ? <span className="truncate">{worker.name}</span> : null}
                    </span>
                    {pausedReason ? (
                      <span className="ac-mono ac-truncate ml-5 rounded-r4 bg-bg-2 px-2 py-1 text-nano text-text-3">paused · {pausedReason}</span>
                    ) : line ? (
                      <span className="ac-mono ac-truncate ml-5 rounded-r4 bg-bg-2 px-2 py-1 text-nano text-text-2">{line}</span>
                    ) : null}
                  </A>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}
