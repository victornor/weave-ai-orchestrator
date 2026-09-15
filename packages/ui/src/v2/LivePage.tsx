/**
 * V2's Live floor (web-v2/live, VS-350).
 *
 * Every live worker across the workspaces as a grid of trace feeds. Two cards per row by default on
 * desktop, with a `−/+` control for one to four per row and a feed height that scales inversely; one
 * column on phone. Scope chips filter for real, and the header's roster/shown figures come from the
 * same worker array the grid renders (HANDOFF §8, §15). Each card's trace is VS-345's shared
 * `WorkerFeed`, so Live opens no private run stream. VS-372 gives the floor one shared tile height;
 * VS-429 moves its control from an invisible bar above the grid onto a corner grip on every tile, so
 * one drag, keyboard press or double-click reset on any tile resizes them all, remembered beside
 * the per-row count. VS-455 makes the scope URL-addressable (`?ws=`), so a `/w/$ws/live` link
 * lands pre-filtered to that workspace.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { projectLabel, type Agent, type Ticket, type UiStatus } from '@weave-ai/shared';
import { resolveModel } from '@weave-ai/render';
import { useModelsMany, useRuntimeModels, useTicketsMany, useWorkersMany, useWorkspaceProjects, useWorkspaces } from '../api/hooks';
import { useGo, useSearchParams } from '../app/link';
import { liveWorkingAgents } from '../lib/board';
import { agentIsWorking, cellUiStatus, orderByRunning, useRunningWorkerIds } from '../lib/liveOrder';
import { modelOptionLabel } from '../lib/runtime';
import { projectColorVar } from '../lib/projectColor';
import { STATUS_LABEL, STATUS_TEXT } from '../lib/status';
import { cx } from '../lib/cx';
import { SkeletonCards } from '../components/Skeleton';
import { EmptyState, ErrorState } from '../components/States';
import { workerModelTagLabel } from '../components/WorkerModelTag';
import { V2Page } from './V2Page';
import { ResizeGrip, WorkerFeed, useWorkerRun } from './WorkerFeed';
import { LIVE_COLUMNS_DEFAULT, LIVE_COLUMNS_MAX, LIVE_COLUMNS_MIN, LIVE_HEIGHT_MIN, LIVE_HEIGHT_STEP, clampLiveHeight, maxLiveHeight, readLiveColumns, readLiveHeight, writeLiveColumns, writeLiveHeight } from './prefs';

/** The feed height for each cards-per-row choice (HANDOFF §8: the ladder scales inversely). */
export const LIVE_FEED_HEIGHT: Record<number, number> = { 1: 420, 2: 300, 3: 240, 4: 200 };

function usePhone(): boolean {
  const [phone, setPhone] = useState(() => (typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia('(max-width: 640px)').matches : false));
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia('(max-width: 640px)');
    const onChange = (): void => setPhone(mq.matches);
    onChange();
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return phone;
}

/** The live viewport height, so the tile ceiling is "most of the viewport" rather than a fixed guess. */
function useViewportHeight(): number {
  const [height, setHeight] = useState(() => (typeof window === 'undefined' ? 800 : window.innerHeight));
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onResize = (): void => setHeight(window.innerHeight);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return height;
}

interface ChipProps {
  label: string;
  active: boolean;
  onClick: () => void;
}

function Chip({ label, active, onClick }: ChipProps): React.ReactElement {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cx('h-7 rounded-r4 border px-2.5 text-micro', active ? 'border-accent-edge bg-accent-tint text-text-1' : 'border-line-2 text-text-3 hover:text-text-1')}
    >
      {label}
    </button>
  );
}

interface LiveCellInput {
  id: string;
  name: string;
  status: Agent['status'];
  ticketId: string | null;
  createdAt: string;
  ws: string;
}

/** The corner grip every desktop tile carries and the one shared height it drives (VS-429). */
interface LiveResize {
  height: number;
  min: number;
  max: number;
  step: number;
  onHeight: (px: number) => void;
  onCommit: () => void;
  onReset: () => void;
}

interface LiveCardProps {
  cell: LiveCellInput;
  /** The status the card shows: `working` while it holds the working group, else its own. */
  ui: UiStatus;
  ticket: Ticket | undefined;
  projectLabel: string | null;
  projectColor: string | null;
  optionName: string | null;
  bodyHeight?: number;
  /** Omitted on the phone, where tiles keep their natural height and show no grip. */
  resize?: LiveResize;
  focused: boolean;
}

function LiveCard({ cell, ui, ticket, projectLabel: project, projectColor, optionName, bodyHeight, resize, focused }: LiveCardProps): React.ReactElement {
  const { run } = useWorkerRun(cell.id, cell.ws);
  const runtimeModels = useRuntimeModels(run?.runtimeId ?? null);
  const resolved = resolveModel(runtimeModels.data ?? null, run?.model ?? null);
  const modelLabel = resolved ? modelOptionLabel(resolved) : (run?.model ?? null);
  return (
    <div
      ref={(el) => {
        if (focused) el?.scrollIntoView?.({ block: 'nearest' });
      }}
      data-v2-live-card={cell.id}
      data-v2-live-status={ui}
      data-focused={focused ? 'true' : undefined}
      className={cx('v2-anim-rise relative flex flex-col overflow-hidden rounded-r4 border bg-bg-1', focused ? 'border-accent-edge' : 'border-line-1')}
    >
      <div className="flex items-center gap-2 border-b border-line-1 px-2.5 py-2">
        <span className="min-w-0 flex-none truncate text-ui font-medium text-text-1">{cell.name}</span>
        <span className="ac-mono min-w-0 flex-1 truncate text-nano text-text-3">{modelLabel ?? '—'}</span>
        <span className={cx('ac-mono flex-none text-nano', STATUS_TEXT[ui])}>{STATUS_LABEL[ui]}</span>
      </div>
      <div className="flex items-center gap-2 border-b border-line-1 bg-bg-2 px-2.5 py-1.5">
        {ticket ? <span className="ac-mono flex-none text-nano text-text-2">{ticket.identifier}</span> : null}
        {project ? (
          <span className="ac-mono flex-none text-nano" style={projectColor ? { color: projectColor } : undefined}>
            {project}
          </span>
        ) : null}
        <span className="min-w-0 flex-1 truncate text-micro text-text-3">{ticket?.title ?? ''}</span>
        {optionName ? <span className="v2-tag flex-none text-text-3">{optionName}</span> : null}
      </div>
      <WorkerFeed agentId={cell.id} ws={cell.ws} bodyHeight={bodyHeight} showChrome={false} label={`${cell.name} live feed`} />
      {resize ? (
        <ResizeGrip
          height={resize.height}
          min={resize.min}
          max={resize.max}
          step={resize.step}
          label="Resize all live tiles"
          onHeight={resize.onHeight}
          onCommit={resize.onCommit}
          onReset={resize.onReset}
        />
      ) : null}
    </div>
  );
}

/** The screen as a V2 destination: the standard header over the Live body. */
export function V2LivePage(): React.ReactElement {
  return (
    <V2Page title="Live" scroll={false}>
      <LiveBody />
    </V2Page>
  );
}

export function LiveBody(): React.ReactElement {
  const search = useSearchParams();
  const go = useGo();
  const workspaces = useWorkspaces();
  const listed = workspaces.data ?? [];
  const ids = useMemo(() => listed.map((w) => w.id), [listed]);

  const workersQueries = useWorkersMany(ids);
  const ticketQueries = useTicketsMany(ids, { limit: 300 });
  const modelQueries = useModelsMany(ids);
  const projectsByWs = useWorkspaceProjects(ids);

  const phone = usePhone();
  const viewportHeight = useViewportHeight();
  const [cols, setCols] = useState<number>(() => readLiveColumns());
  const [customHeight, setCustomHeight] = useState<number | null>(() => readLiveHeight());
  // VS-455: the scope travels in the address, so `/v2/live?ws=<id>` opens pre-filtered to that
  // workspace (V1's `/w/$ws/live` redirects here) and a reload or shared link keeps it. With no
  // param the default is unchanged (Everywhere).
  const [scope, setScope] = useState<string>(() => search['ws'] ?? 'all');
  // A `ws` naming no loaded workspace reads as Everywhere rather than an empty floor, as RunsPage's does.
  const shownScope = scope === 'all' || listed.some((w) => w.id === scope) ? scope : 'all';

  // Choosing a scope writes it back into the URL without stacking history, so the choice survives a
  // reload and back/forward. The `?worker=` focus below still sets the scope directly: it is the
  // worker, not the address, that names the workspace there.
  const chooseScope = (id: string): void => {
    setScope(id);
    go('/v2/live', { search: { ...search, ws: id === 'all' ? undefined : id }, replace: true });
  };

  // The chosen height is a device preference, so a drag is written once when its grip is released
  // (see `commitHeight`) rather than on every move; an arrow step or reset writes immediately.
  const onGripHeight = useCallback((px: number): void => setCustomHeight(px), []);
  const commitHeight = useCallback((): void => {
    setCustomHeight((current) => {
      writeLiveHeight(current);
      return current;
    });
  }, []);
  const resetHeight = useCallback((): void => {
    setCustomHeight(null);
    writeLiveHeight(null);
  }, []);

  const cells = useMemo<LiveCellInput[]>(() => {
    const out: LiveCellInput[] = [];
    ids.forEach((ws, i) => {
      for (const a of liveWorkingAgents(workersQueries[i]?.data ?? [])) {
        out.push({ id: a.id, name: a.name, status: a.status, ticketId: a.ticketId ?? null, createdAt: a.createdAt, ws });
      }
    });
    return out;
  }, [ids, workersQueries]);

  // VS-415: the working group, the card's label and the floor figure all read this one set. A worker
  // that just stopped running is held in it for the grace window, so the card keeps reading working
  // and the order never splits the group across a between-turns card.
  const workingIds = useRunningWorkerIds(useMemo(() => new Set(cells.filter((c) => agentIsWorking(c.status)).map((c) => c.id)), [cells]));
  const ordered = useMemo(() => orderByRunning(cells, (c) => ({ id: c.id, createdAt: c.createdAt }), workingIds), [cells, workingIds]);

  const ticketsById = useMemo(() => {
    const m = new Map<string, Ticket>();
    for (const q of ticketQueries) for (const t of q.data ?? []) m.set(t.id, t);
    return m;
  }, [ticketQueries]);

  const filtered = useMemo(() => ordered.filter((c) => shownScope === 'all' || c.ws === shownScope), [ordered, shownScope]);

  // A Map worker node opens Live with `?worker=`: apply that worker's workspace scope once, when the
  // parameter first resolves, and mark it focused. Applying it on every render would fight the scope
  // chips and make Everywhere or another workspace unclickable while the parameter is present.
  const focusId = search['worker'] ?? null;
  const focusCell = useMemo(() => (focusId ? cells.find((c) => c.id === focusId) ?? null : null), [cells, focusId]);
  const handledFocus = useRef<string | null>(null);
  useEffect(() => {
    if (!focusId || !focusCell || handledFocus.current === focusId) return;
    handledFocus.current = focusId;
    setScope((current) => (current === focusCell.ws ? current : focusCell.ws));
  }, [focusId, focusCell]);

  const loaded = Boolean(workspaces.data) && workersQueries.every((q) => q.data !== undefined || q.isError);
  const errored = workersQueries.length > 0 && workersQueries.every((q) => q.isError);

  const step = (delta: number): void => {
    const next = Math.min(LIVE_COLUMNS_MAX, Math.max(LIVE_COLUMNS_MIN, cols + delta));
    setCols(next);
    writeLiveColumns(next);
  };

  if (workspaces.isError) {
    return <ErrorState code="WORKSPACES_QUERY_FAILED" message="Could not load workspaces." onRetry={() => void workspaces.refetch()} />;
  }
  if (!workspaces.data || !loaded) return <SkeletonCards count={2} />;
  if (errored) return <ErrorState code="LIVE_QUERY_FAILED" message="Could not load the live floor." onRetry={() => void workersQueries[0]?.refetch()} />;

  const effectiveCols = phone ? 1 : cols;
  const ladderHeight = LIVE_FEED_HEIGHT[effectiveCols] ?? LIVE_FEED_HEIGHT[LIVE_COLUMNS_DEFAULT]!;
  // Phone keeps the natural single-column height; desktop uses the dragged height, else the ladder.
  const bodyHeight = phone ? undefined : clampLiveHeight(customHeight ?? ladderHeight, viewportHeight);
  // One grip object is shared by every desktop tile, so a drag on any of them resizes the whole
  // floor together (VS-429); on the phone there is no fixed height and no grip.
  const resize: LiveResize | undefined =
    bodyHeight === undefined
      ? undefined
      : { height: bodyHeight, min: LIVE_HEIGHT_MIN, max: maxLiveHeight(viewportHeight), step: LIVE_HEIGHT_STEP, onHeight: onGripHeight, onCommit: commitHeight, onReset: resetHeight };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-1.5 border-b border-line-1 px-4 py-2">
        <Chip label="Everywhere" active={shownScope === 'all'} onClick={() => chooseScope('all')} />
        {listed.map((w) => (
          <Chip key={w.id} label={w.name} active={shownScope === w.id} onClick={() => chooseScope(w.id)} />
        ))}
        <span className="ml-auto ac-mono text-micro text-text-3" aria-live="polite">
          {filtered.filter((c) => workingIds.has(c.id)).length} running · showing {filtered.length}
        </span>
        {!phone ? (
          <span className="flex flex-none items-center gap-1 rounded-r4 border border-line-1 bg-bg-2 p-0.5" data-v2-live-cols>
            <button type="button" aria-label="Fewer per row" onClick={() => step(-1)} className="px-1.5 text-text-3 hover:text-text-1">
              −
            </button>
            <span className="ac-mono min-w-[1.5rem] text-center text-nano text-text-2">{cols}</span>
            <button type="button" aria-label="More per row" onClick={() => step(1)} className="px-1.5 text-text-3 hover:text-text-1">
              +
            </button>
          </span>
        ) : null}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-4" data-v2-live-scroll>
        {ordered.length === 0 ? (
          <EmptyState title="No workers are running." detail="Workers appear here while they are on a ticket." />
        ) : filtered.length === 0 ? (
          <EmptyState title="Nothing in this scope." detail="Choose another workspace or Everywhere." />
        ) : (
          <div data-v2-live-grid data-cols={effectiveCols} style={{ display: 'grid', gridTemplateColumns: `repeat(${effectiveCols}, minmax(0, 1fr))`, gap: 12 }}>
            {filtered.map((cell) => {
              const i = ids.indexOf(cell.ws);
              const ticket = cell.ticketId ? ticketsById.get(cell.ticketId) : undefined;
              const projects = projectsByWs[cell.ws]?.projects ?? [];
              const worker = workersQueries[i]?.data?.find((w) => w.id === cell.id);
              const project = worker?.projectId ? projects.find((p) => p.id === worker.projectId) : undefined;
              const options = modelQueries[i]?.data?.workerOptions;
              return (
                <LiveCard
                  key={cell.id}
                  cell={cell}
                  ui={cellUiStatus(cell.status, workingIds.has(cell.id))}
                  ticket={ticket}
                  projectLabel={project ? projectLabel(project) : null}
                  projectColor={project ? projectColorVar(project.id, projects.map((p) => p.id)) : null}
                  optionName={ticket ? workerModelTagLabel(ticket, options) : null}
                  bodyHeight={bodyHeight}
                  resize={resize}
                  focused={Boolean(focusId && focusCell?.id === cell.id)}
                />
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
