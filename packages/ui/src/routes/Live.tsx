/**
 * Workspace live floor (VS-152): one cell per currently-working worker, each streaming that
 * worker's in-progress run. Membership is `liveWorkingAgents` — the same liveness predicate the
 * board uses, listed as workers. No steer/attach/resume from a cell; the ticket is the way in.
 *
 * VS-164: desktop cells drag-resize by CSS-grid span; phone expands by tap. Sizes last the tab.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { agentUiStatus, isActiveRun, type Agent, type Run, type Ticket } from '@agent-conductor/shared';
import { Page, PageBody, PageHeader } from '../components/Page';
import { RunTranscript } from '../components/RunTranscript';
import { StreamStatusNotice } from '../components/StreamStatus';
import { SkeletonCards } from '../components/Skeleton';
import { EmptyState, ErrorState } from '../components/States';
import { StatusBadge } from '../components/StatusGlyph';
import { Button } from '../components/Button';
import { useRuns, useTickets, useWorkers } from '../api/hooks';
import { useRunEventStream } from '../api/runStream';
import { useWs } from '../api/context';
import { A } from '../app/link';
import { liveWorkingAgents } from '../lib/board';
import { cx } from '../lib/cx';
import {
  type CellSize,
  columnCount,
  DEFAULT_SIZE,
  readLiveCellSizes,
  sameSize,
  sizeOf,
  snapSize,
  writeLiveCellSizes,
} from '../lib/liveCellSize';

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => (typeof window !== 'undefined' ? window.matchMedia(query).matches : false));
  useEffect(() => {
    const mq = window.matchMedia(query);
    const onChange = (): void => setMatches(mq.matches);
    onChange();
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [query]);
  return matches;
}

export function LiveRoute(): React.ReactElement {
  const ws = useWs();
  const workers = useWorkers({});
  const tickets = useTickets({ limit: 300 });
  const running = useRuns({ status: 'running', limit: 200 });
  const queued = useRuns({ status: 'queued', limit: 200 });
  const minSm = useMediaQuery('(min-width: 40rem)');
  const minXl = useMediaQuery('(min-width: 80rem)');
  const colsMax = columnCount(minSm, minXl);
  const [sizes, setSizes] = useState(() => readLiveCellSizes(ws));

  const live = useMemo(() => liveWorkingAgents(workers.data ?? []), [workers.data]);
  const ticketsById = useMemo(() => {
    const map = new Map<string, Ticket>();
    for (const t of tickets.data ?? []) map.set(t.id, t);
    return map;
  }, [tickets.data]);
  const runByAgent = useMemo(() => {
    const map = new Map<string, Run>();
    for (const r of [...(queued.data ?? []), ...(running.data ?? [])]) {
      if (!isActiveRun(r.status)) continue;
      const seen = map.get(r.agentId);
      if (!seen || r.createdAt > seen.createdAt) map.set(r.agentId, r);
    }
    return map;
  }, [running.data, queued.data]);

  const liveIds = useMemo(() => live.map((w) => w.id), [live]);
  const commit = useCallback((id: string, next: CellSize) => {
    setSizes((prev) => writeLiveCellSizes(ws, { ...prev, [id]: next }, liveIds));
  }, [ws, liveIds]);

  const loaded = workers.data !== undefined;
  const n = live.length;

  return (
    <Page>
      <PageHeader title="Live" meta={loaded ? (n === 1 ? '1 working' : `${n} working`) : undefined} />
      <PageBody className="p-4 md:p-5">
        {workers.isError ? (
          <ErrorState
            code="WORKERS_QUERY_FAILED"
            message="Could not load who is working."
            onRetry={() => void workers.refetch()}
          />
        ) : !loaded ? (
          <SkeletonCards count={4} className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" />
        ) : n === 0 ? (
          <EmptyState title="Nobody is working." detail="Live workers on a ticket show up here. Paused and idle ones stay on Team and the board." />
        ) : (
          <div className="grid grid-flow-dense gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {live.map((w) => (
              <LiveCell
                key={w.id}
                agent={w}
                ticket={w.ticketId ? ticketsById.get(w.ticketId) : undefined}
                run={runByAgent.get(w.id) ?? null}
                size={sizeOf(sizes, w.id, colsMax)}
                colsMax={colsMax}
                desktop={minSm}
                onSize={(next) => commit(w.id, next)}
              />
            ))}
          </div>
        )}
      </PageBody>
    </Page>
  );
}

function LiveCell({
  agent,
  ticket,
  run,
  size,
  colsMax,
  desktop,
  onSize,
}: {
  agent: Agent;
  ticket: Ticket | undefined;
  run: Run | null;
  size: CellSize;
  colsMax: number;
  desktop: boolean;
  onSize: (next: CellSize) => void;
}): React.ReactElement {
  const ws = useWs();
  const streaming = Boolean(run && isActiveRun(run.status));
  const { events, status, retryNow } = useRunEventStream(streaming && run ? run.id : null, { live: streaming });
  const identifier = ticket?.identifier ?? agent.ticketId;
  const title = ticket?.title;
  const ticketLabel = [identifier, title].filter(Boolean).join(' · ') || 'ticket';
  const [drag, setDrag] = useState<CellSize | null>(null);
  const shown = drag ?? size;
  const tall = shown.rows >= 2;

  return (
    <article
      className={cx(
        'ac-card relative flex min-h-0 flex-col overflow-hidden',
        shown.cols === 2 && 'col-span-2',
        shown.cols === 3 && 'col-span-3',
        shown.rows === 2 && 'row-span-2',
      )}
    >
      <header className="flex items-start gap-2.5 border-b border-line-1 px-3.5 py-2.5">
        <div className="min-w-0 flex-1">
          <div className="truncate text-ui font-medium text-text-1">{agent.name}</div>
          {identifier ? (
            <A
              to="/w/$ws/tickets/$ticketId"
              params={{ ws, ticketId: identifier }}
              className="ac-mono mt-0.5 block truncate text-micro text-accent-link hover:underline"
            >
              {ticketLabel}
            </A>
          ) : (
            <div className="ac-mono mt-0.5 truncate text-micro text-text-3">no ticket</div>
          )}
        </div>
        {desktop ? null : (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onSize(shown.expanded ? DEFAULT_SIZE : { cols: 1, rows: 2, expanded: true })}
          >
            {shown.expanded ? 'Restore' : 'Expand'}
          </Button>
        )}
        <StatusBadge status={agentUiStatus(agent.status)} />
      </header>
      <div className="min-h-0 flex-1 p-2.5">
        {streaming ? (
          <>
            <StreamStatusNotice status={status} onRetry={retryNow} className="mb-2" />
            <RunTranscript
              events={events}
              live
              label={`Transcript of ${agent.name}`}
              className={tall
                ? 'max-h-[calc(var(--ac-app-h)*0.5)] md:max-h-[calc(var(--ac-app-h)*0.6)]'
                : 'max-h-[calc(var(--ac-app-h)*0.25)] md:max-h-[calc(var(--ac-app-h)*0.3)]'}
            />
          </>
        ) : (
          <p className="px-1 py-2 text-micro text-text-3">Waiting for the next turn.</p>
        )}
      </div>
      {desktop ? (
        <ResizeHandle
          name={agent.name}
          size={shown}
          colsMax={colsMax}
          onPreview={setDrag}
          onCommit={(next) => {
            setDrag(null);
            if (!sameSize(next, size)) onSize(next);
          }}
          onReset={() => {
            setDrag(null);
            onSize(DEFAULT_SIZE);
          }}
        />
      ) : null}
    </article>
  );
}

function ResizeHandle({
  name,
  size,
  colsMax,
  onPreview,
  onCommit,
  onReset,
}: {
  name: string;
  size: CellSize;
  colsMax: number;
  onPreview: (next: CellSize | null) => void;
  onCommit: (next: CellSize) => void;
  onReset: () => void;
}): React.ReactElement {
  const [origin, setOrigin] = useState<{
    start: CellSize;
    x: number;
    y: number;
    unitW: number;
    unitH: number;
  } | null>(null);
  const previewRef = useRef(onPreview);
  const commitRef = useRef(onCommit);
  previewRef.current = onPreview;
  commitRef.current = onCommit;

  const startDrag = (e: React.PointerEvent<HTMLDivElement>): void => {
    const cell = e.currentTarget.closest('article');
    if (!cell) return;
    const rect = cell.getBoundingClientRect();
    e.preventDefault();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    setOrigin({
      start: size,
      x: e.clientX,
      y: e.clientY,
      unitW: rect.width / size.cols,
      unitH: rect.height / size.rows,
    });
  };

  useEffect(() => {
    if (!origin) return;
    let latest: CellSize | null = null;
    const move = (e: PointerEvent): void => {
      latest = snapSize(origin.start, e.clientX - origin.x, e.clientY - origin.y, origin.unitW, origin.unitH, colsMax);
      previewRef.current(latest);
    };
    const end = (): void => {
      commitRef.current(latest ?? origin.start);
      setOrigin(null);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
    };
  }, [origin, colsMax]);

  const onKey = (e: React.KeyboardEvent<HTMLDivElement>): void => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onReset();
      return;
    }
    const next =
      e.key === 'ArrowRight' ? snapSize(size, 1, 0, 1, 1, colsMax)
      : e.key === 'ArrowLeft' ? snapSize(size, -1, 0, 1, 1, colsMax)
      : e.key === 'ArrowDown' ? snapSize(size, 0, 1, 1, 1, colsMax)
      : e.key === 'ArrowUp' ? snapSize(size, 0, -1, 1, 1, colsMax)
      : null;
    if (!next) return;
    e.preventDefault();
    onCommit(next);
  };

  return (
    <div
      aria-label={`Resize ${name}`}
      tabIndex={0}
      title="Drag to resize · double-click to reset"
      onPointerDown={startDrag}
      onDoubleClick={onReset}
      onKeyDown={onKey}
      className="absolute right-0 bottom-0 z-10 flex size-4 cursor-nwse-resize touch-none items-end justify-end p-1 outline-none focus-visible:bg-bg-2"
    >
      <span className="size-1.5 border-r-2 border-b-2 border-line-3" />
    </div>
  );
}
