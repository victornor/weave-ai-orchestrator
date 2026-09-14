/**
 * V2's Runs screen (web-v2/runs, VS-350).
 *
 * Every workspace's turns in one dense, filterable table. The runs API is per workspace, so the
 * pages are fanned out, merged by recency, and a real load-more raises each workspace's page size
 * from the totals the server already returns (HANDOFF §12, §15). V1's Runs page is untouched.
 */
import { useMemo, useState } from 'react';
import { RUN_STATUSES, type Run, type RunStatus, type UiStatus } from '@weave-ai/shared';
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

/** Newest first, id as the tie-break; the merge across workspaces is by `createdAt`, not page order. */
export function mergeRuns(runs: readonly Run[]): Run[] {
  return [...runs].sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : a.id < b.id ? 1 : -1));
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
  const [pageSize, setPageSize] = useState(RUNS_PAGE_SIZE);

  const workspaces = useWorkspaces();
  const listed = workspaces.data ?? [];
  const ids = useMemo(() => listed.map((w) => w.id), [listed]);
  const params = useMemo(() => (status ? { status, limit: pageSize } : { limit: pageSize }), [status, pageSize]);
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

  const rows = useMemo(() => mergeRuns(pages.flatMap((q) => q.data?.runs ?? [])), [pages]);
  const total = useMemo(() => pages.reduce((n, q) => n + (q.data?.total ?? 0), 0), [pages]);
  const hasMore = rows.length < total;
  const loaded = Boolean(workspaces.data) && pages.every((q) => q.data !== undefined || q.isError);
  const errored = pages.length > 0 && pages.every((q) => q.isError);

  const nameOf = (id: string): string => nameById.get(id) ?? 'Unknown agent';
  const open = (r: Run): void => go('/v2/runs/$runId', { params: { runId: r.id } });

  const stateChips = (
    <div className="flex items-center gap-2 overflow-x-auto border-b border-line-1 px-4 py-2" data-v2-runs-filters>
      <Segmented
        ariaLabel="Run state"
        mono
        options={[{ value: '', label: 'all' }, ...RUN_STATUSES.map((s) => ({ value: s as string, label: s }))]}
        value={status}
        onChange={(v) => {
          setStatus(v);
          setPageSize(RUNS_PAGE_SIZE);
        }}
      />
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
                <li key={r.id}>
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
                    render: (r) => (r.startedAt && r.finishedAt ? duration(new Date(r.finishedAt).getTime() - new Date(r.startedAt).getTime()) : '—'),
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
