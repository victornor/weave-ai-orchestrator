/**
 * V2's Runs screen (web-v2/runs, VS-350).
 *
 * Every workspace's turns in one dense, filterable table. The runs API is per workspace, so the
 * pages are fanned out, merged by recency, and a real load-more raises each workspace's page size
 * from the totals the server already returns (HANDOFF §12, §15). V1's Runs page is untouched.
 *
 * VS-410: the screen can be narrowed to one workspace and ordered by cost, duration or tokens.
 * Ordering is done by the server (each workspace page is sorted by the same key) and the merge
 * repeats the comparator, so the order covers the whole history, not only the loaded rows.
 */
import { useMemo, useState } from 'react';
import { RUN_SORT_KEYS, RUN_STATUSES, type Run, type RunSortDir, type RunSortKey, type RunStatus, type UiStatus } from '@weave-ai/shared';
import { useRunPagesMany, useWeaverMany, useWorkersMany, useWorkspaces } from '../api/hooks';
import { useGo, useSearchParams } from '../app/link';
import { EmptyState, ErrorState } from '../components/States';
import { SkeletonRows } from '../components/Skeleton';
import { Segmented } from '../components/Tabs';
import { StatusGlyph } from '../components/StatusGlyph';
import { Table } from '../components/Table';
import { ago, cents, duration, tokens } from '../lib/format';
import { cx } from '../lib/cx';
import { V2Page } from './V2Page';

export const RUNS_PAGE_SIZE = 50;

export const RUN_UI: Record<RunStatus, UiStatus> = {
  queued: 'idle',
  running: 'working',
  succeeded: 'done',
  failed: 'failed',
  timed_out: 'failed',
  cancelled: 'paused',
  interrupted: 'stalled',
};

/** How a turn ended, in words. `needs_decision` means it asked the human. */
export const LIVENESS_TEXT: Record<string, string> = {
  advanced: 'made progress',
  plan_only: 'planned only',
  empty: 'no progress',
  idle: 'correctly idle',
  blocked: 'blocked',
  needs_decision: 'asked you',
  failed: 'failed',
};

export function turnEnded(run: Pick<Run, 'liveness'>): string {
  return run.liveness ? (LIVENESS_TEXT[run.liveness] ?? run.liveness) : '—';
}

export function runTokenTotal(run: Pick<Run, 'usage'>): string {
  return tokens((run.usage?.inputTokens ?? 0) + (run.usage?.outputTokens ?? 0));
}

/** The runs sort control's value: the default recency order, or a measure and a direction. */
export interface RunOrder {
  sort: RunSortKey;
  dir: RunSortDir;
}

export const DEFAULT_RUN_ORDER: RunOrder = { sort: 'createdAt', dir: 'desc' };

/** The order key the server and the merge share; `createdAt` is omitted from the query. */
export function orderParams(order: RunOrder): { sort?: RunSortKey; dir?: RunSortDir } {
  return order.sort === 'createdAt' ? {} : { sort: order.sort, dir: order.dir };
}

/** The URL names a measure and a direction; anything else reads as the default. */
export function orderFromSearch(search: Record<string, string | undefined>): RunOrder {
  const sort = search['sort'];
  if (!(RUN_SORT_KEYS as readonly string[]).includes(sort ?? '')) return DEFAULT_RUN_ORDER;
  return { sort: sort as RunSortKey, dir: search['dir'] === 'asc' ? 'asc' : 'desc' };
}

const ORDER_LABELS: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'createdAt:desc', label: 'Newest first' },
  { value: 'cost:desc', label: 'Cost: high to low' },
  { value: 'cost:asc', label: 'Cost: low to high' },
  { value: 'duration:desc', label: 'Duration: longest first' },
  { value: 'duration:asc', label: 'Duration: shortest first' },
  { value: 'tokens:desc', label: 'Tokens: most first' },
  { value: 'tokens:asc', label: 'Tokens: fewest first' },
];

/** The measure a run carries for the active sort, or null when it has none (sort those last). */
export function runSortValue(run: Run, sort: RunSortKey, now = Date.now()): number | null {
  switch (sort) {
    case 'cost':
      return run.costCents;
    case 'tokens':
      return run.usage ? run.usage.inputTokens + run.usage.outputTokens : null;
    case 'duration': {
      if (!run.startedAt) return null;
      // A running run's duration is its elapsed time so far, exactly as the server's query reads it.
      const end = run.finishedAt ? Date.parse(run.finishedAt) : now;
      const ms = end - Date.parse(run.startedAt);
      return Number.isFinite(ms) && ms >= 0 ? ms : null;
    }
    default:
      return Date.parse(run.createdAt);
  }
}

/** Newest first, id as the tie-break — the merge's stable fallback. */
function newestFirst(a: Run, b: Run): number {
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? 1 : -1;
  if (a.id !== b.id) return a.id < b.id ? 1 : -1;
  return 0;
}

/**
 * Order runs across workspaces. The default is unchanged (newest first); a measure the run does not
 * carry sorts last in both directions, and ties fall back to recency so paging stays stable.
 */
export function mergeRuns(runs: readonly Run[], sort: RunSortKey = 'createdAt', dir: RunSortDir = 'desc', now = Date.now()): Run[] {
  const sign = dir === 'asc' ? 1 : -1;
  return [...runs].sort((a, b) => {
    if (sort === 'createdAt') {
      const c = newestFirst(a, b);
      return dir === 'asc' ? -c : c;
    }
    const av = runSortValue(a, sort, now);
    const bv = runSortValue(b, sort, now);
    if (av === null || bv === null) {
      if (av === null && bv === null) return newestFirst(a, b);
      return av === null ? 1 : -1;
    }
    if (av === bv) return newestFirst(a, b);
    return av < bv ? -sign : sign;
  });
}

export function V2RunsPage(): React.ReactElement {
  return (
    <V2Page title="Runs">
      <RunsBody />
    </V2Page>
  );
}

export function RunsBody(): React.ReactElement {
  const go = useGo();
  const search = useSearchParams();
  const [status, setStatus] = useState<string>(() => {
    const s = search['state'];
    return s && (RUN_STATUSES as readonly string[]).includes(s) ? s : '';
  });
  const [scope, setScope] = useState<string>(() => search['ws'] ?? '');
  const [order, setOrder] = useState<RunOrder>(() => orderFromSearch(search));
  const [pageSize, setPageSize] = useState(RUNS_PAGE_SIZE);

  const workspaces = useWorkspaces();
  const listed = workspaces.data ?? [];
  // A `ws` in the URL that names no loaded workspace reads as `All` (the option list cannot show it).
  const shownScope = listed.some((w) => w.id === scope) ? scope : '';
  const ids = useMemo(() => (shownScope ? [shownScope] : listed.map((w) => w.id)), [listed, shownScope]);
  const params = useMemo(
    () => ({ ...(status ? { status } : {}), ...orderParams(order), limit: pageSize }),
    [status, order, pageSize],
  );
  const pages = useRunPagesMany(ids, params);
  const workers = useWorkersMany(ids, { includeRetired: true });
  const weavers = useWeaverMany(ids);

  // A run's agent is a worker or its workspace's weaver, so resolve both; an unresolved agent reads
  // as a neutral label rather than a sliced id (VS-403).
  const nameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const q of workers) for (const w of q.data ?? []) m.set(w.id, w.name);
    for (const q of weavers) {
      const agent = q.data?.agent;
      if (agent) m.set(agent.id, agent.name);
    }
    return m;
  }, [workers, weavers]);

  const rows = useMemo(
    () => mergeRuns(pages.flatMap((q) => q.data?.runs ?? []), order.sort, order.dir),
    [pages, order],
  );
  const total = useMemo(() => pages.reduce((n, q) => n + (q.data?.total ?? 0), 0), [pages]);
  const hasMore = rows.length < total;
  const loaded = Boolean(workspaces.data) && pages.every((q) => q.data !== undefined || q.isError);
  const errored = pages.length > 0 && pages.every((q) => q.isError);

  const nameOf = (id: string): string => nameById.get(id) ?? 'Unknown agent';
  const open = (r: Run): void => go('/v2/runs/$runId', { params: { runId: r.id } });

  /** Keep the URL current without stacking history, so the choice survives reload and back/forward. */
  const commit = (patch: Record<string, string | undefined>): void => {
    go('/v2/runs', { search: { ...search, ...patch }, replace: true });
  };
  const chooseScope = (id: string): void => {
    setScope(id);
    setPageSize(RUNS_PAGE_SIZE);
    commit({ ws: id || undefined });
  };
  const chooseStatus = (v: string): void => {
    setStatus(v);
    setPageSize(RUNS_PAGE_SIZE);
    commit({ state: v || undefined });
  };
  const chooseOrder = (value: string): void => {
    const [sort, dir] = value.split(':') as [RunSortKey, RunSortDir];
    const next: RunOrder = { sort, dir: dir === 'asc' ? 'asc' : 'desc' };
    setOrder(next);
    setPageSize(RUNS_PAGE_SIZE);
    commit(orderParams(next).sort ? { sort: next.sort, dir: next.dir } : { sort: undefined, dir: undefined });
  };

  const stateChips = (
    <div className="flex items-center gap-2 overflow-x-auto border-b border-line-1 px-4 py-2" data-v2-runs-filters>
      {listed.length > 1 ? (
        <select
          aria-label="Workspace"
          className="h-7 shrink-0 rounded-r4 border border-line-2 bg-bg-1 px-2 text-micro text-text-2 outline-none"
          value={shownScope}
          onChange={(e) => chooseScope(e.target.value)}
        >
          <option value="">All workspaces</option>
          {listed.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name}
            </option>
          ))}
        </select>
      ) : null}
      <Segmented
        ariaLabel="Run state"
        mono
        options={[{ value: '', label: 'all' }, ...RUN_STATUSES.map((s) => ({ value: s as string, label: s }))]}
        value={status}
        onChange={chooseStatus}
      />
      <span className="mx-1 h-4 w-px shrink-0 bg-line-2" aria-hidden />
      <select
        aria-label="Sort runs"
        className="h-7 shrink-0 rounded-r4 border border-line-2 bg-bg-1 px-2 text-micro text-text-2 outline-none"
        value={`${order.sort}:${order.dir}`}
        onChange={(e) => chooseOrder(e.target.value)}
      >
        {ORDER_LABELS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <span className="ml-auto ac-mono whitespace-nowrap text-micro text-text-3" aria-live="polite">
        {hasMore ? `${rows.length} of ${total}` : `${rows.length} shown`}
      </span>
    </div>
  );

  if (workspaces.isError) {
    return <ErrorState code="WORKSPACES_QUERY_FAILED" message="Could not load workspaces." onRetry={() => void workspaces.refetch()} />;
  }
  if (!workspaces.data || !loaded) {
    return (
      <>
        {stateChips}
        <div className="p-4">
          <SkeletonRows rows={8} />
        </div>
      </>
    );
  }
  if (errored) {
    return <ErrorState code="RUNS_QUERY_FAILED" message="Could not list runs." onRetry={() => void pages[0]?.refetch()} />;
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {stateChips}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {rows.length === 0 ? (
          <div className="p-6">
            <EmptyState title="No runs yet." detail="A run appears whenever an agent takes a turn." />
          </div>
        ) : (
          <>
            {/* phone: one card per run */}
            <ol className="md:hidden" data-v2-runs-phone>
              {rows.map((r) => (
                <li key={r.id} className="v2-anim-rise">
                  <button type="button" onClick={() => open(r)} className="flex w-full items-center gap-3 border-b border-line-1 px-4 py-3 text-left">
                    <StatusGlyph status={RUN_UI[r.status]} size="sm" pulse={r.status === 'running'} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-ui text-text-1">{nameOf(r.agentId)}</span>
                      <span className="ac-mono block truncate text-micro text-text-3">
                        {r.model ?? '—'} · {runTokenTotal(r)} tok · {cents(r.costCents)}
                      </span>
                    </span>
                    <span className="ac-mono text-nano text-text-3">{ago(r.startedAt ?? r.createdAt)}</span>
                  </button>
                </li>
              ))}
            </ol>

            <div className={cx('hidden md:block')} data-v2-runs-table>
              <Table
                rows={rows}
                rowKey={(r) => r.id}
                onRowClick={open}
                columns={[
                  {
                    key: 'status',
                    header: 'Status',
                    width: '9rem',
                    render: (r) => (
                      <span className="flex items-center gap-2">
                        <StatusGlyph status={RUN_UI[r.status]} size="xs" pulse={r.status === 'running'} />
                        <span className="ac-mono text-micro">{r.status}</span>
                      </span>
                    ),
                  },
                  { key: 'agent', header: 'Agent', render: (r) => nameOf(r.agentId) },
                  { key: 'model', header: 'Model', mono: true, render: (r) => r.model ?? '—' },
                  { key: 'ended', header: 'Turn ended', width: '11rem', mono: true, render: (r) => turnEnded(r) },
                  { key: 'tokens', header: 'Tokens', width: '6rem', align: 'right', mono: true, render: (r) => runTokenTotal(r) },
                  { key: 'cost', header: 'Cost', width: '6rem', align: 'right', mono: true, render: (r) => cents(r.costCents) },
                  {
                    key: 'duration',
                    header: 'Duration',
                    width: '7rem',
                    align: 'right',
                    mono: true,
                    render: (r) => (r.startedAt ? duration((r.finishedAt ? Date.parse(r.finishedAt) : Date.now()) - Date.parse(r.startedAt)) : '—'),
                  },
                  { key: 'when', header: 'When', width: '7rem', align: 'right', mono: true, render: (r) => ago(r.startedAt ?? r.createdAt) },
                ]}
              />
            </div>
            {hasMore ? (
              <div className="flex justify-center border-t border-line-1 p-3">
                <button
                  type="button"
                  onClick={() => setPageSize((n) => n + RUNS_PAGE_SIZE)}
                  className="h-7 rounded-r4 border border-line-2 px-3 text-micro text-text-2 hover:text-text-1"
                >
                  Load more
                </button>
              </div>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
