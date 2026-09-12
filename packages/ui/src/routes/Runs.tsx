import { useState } from 'react';
import { RUN_STATUSES } from '@weave-ai/shared';
import { Page, PageBody, PageHeader } from '../components/Page';
import { Table } from '../components/Table';
import { SkeletonRows } from '../components/Skeleton';
import { EmptyState, ErrorState } from '../components/States';
import { Segmented } from '../components/Tabs';
import { StatusGlyph } from '../components/StatusGlyph';
import { useRuns, useWorkers } from '../api/hooks';
import { useWs } from '../api/context';
import { useGo } from '../app/link';
import { ago, cents, duration, tokens } from '../lib/format';
import { cx } from '../lib/cx';

const RUN_UI = {
  queued: 'idle',
  running: 'working',
  succeeded: 'done',
  failed: 'failed',
  timed_out: 'failed',
  cancelled: 'paused',
  interrupted: 'stalled',
} as const;

/** How a turn ended, in words. `needs_decision` means it asked the human; the card may have been answered since. */
const LIVENESS_TEXT: Record<string, string> = { advanced: 'made progress', plan_only: 'planned only', empty: 'no progress', idle: 'correctly idle', blocked: 'blocked', needs_decision: 'asked you', failed: 'failed' };

export function RunsRoute(): React.ReactElement {
  const ws = useWs();
  const go = useGo();
  const [status, setStatus] = useState<string>('');
  const runs = useRuns(status ? { status, limit: 200 } : { limit: 200 });
  const workers = useWorkers({ includeRetired: true });
  const nameOf = (id: string): string => workers.data?.find((w) => w.id === id)?.name ?? id.slice(0, 8);

  return (
    <Page>
      <PageHeader
        title="Runs"
        meta={runs.data ? `${runs.data.length} in view` : undefined}
        actions={
          <Segmented
            ariaLabel="Run status"
            mono
            options={[{ value: '', label: 'all' }, ...RUN_STATUSES.map((s) => ({ value: s as string, label: s }))]}
            value={status}
            onChange={setStatus}
          />
        }
      />
      <PageBody>
        {runs.isLoading ? (
          <SkeletonRows rows={8} />
        ) : runs.isError ? (
          <ErrorState className="m-4" code="RUNS_QUERY_FAILED" message="Could not list runs." onRetry={() => void runs.refetch()} />
        ) : (runs.data?.length ?? 0) === 0 ? (
          <div className="p-6">
            <EmptyState title="No runs yet." detail="A run appears whenever an agent takes a turn." />
          </div>
        ) : (
          <>
            {/* phone: timeline */}
            <ol className="md:hidden">
              {(runs.data ?? []).map((r) => (
                <li key={r.id}>
                  <button
                    type="button"
                    onClick={() => go('/w/$ws/runs/$runId', { params: { ws, runId: r.id } })}
                    className="flex w-full items-center gap-3 border-b border-line-1 px-4 py-3 text-left"
                  >
                    <StatusGlyph status={RUN_UI[r.status]} size="sm" pulse={r.status === 'running'} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-ui text-text-1">{nameOf(r.agentId)}</span>
                      <span className="ac-mono block truncate text-micro text-text-3">
                        {r.model ?? '—'} · {tokens((r.usage?.inputTokens ?? 0) + (r.usage?.outputTokens ?? 0))} tok · {cents(r.costCents)}
                      </span>
                    </span>
                    <span className="ac-mono text-nano text-text-4">{ago(r.startedAt ?? r.createdAt)}</span>
                  </button>
                </li>
              ))}
            </ol>

            <div className={cx('hidden md:block')}>
              <Table
                rows={runs.data ?? []}
                rowKey={(r) => r.id}
                onRowClick={(r) => go('/w/$ws/runs/$runId', { params: { ws, runId: r.id } })}
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
                  { key: 'liveness', header: 'Turn ended', mono: true, render: (r) => LIVENESS_TEXT[r.liveness ?? ''] ?? r.liveness ?? '—' },
                  { key: 'tok', header: 'Tokens', align: 'right', mono: true, render: (r) => tokens((r.usage?.inputTokens ?? 0) + (r.usage?.outputTokens ?? 0)) },
                  { key: 'cost', header: 'Cost', align: 'right', mono: true, render: (r) => cents(r.costCents) },
                  {
                    key: 'dur',
                    header: 'Duration',
                    align: 'right',
                    mono: true,
                    render: (r) => (r.startedAt && r.finishedAt ? duration(new Date(r.finishedAt).getTime() - new Date(r.startedAt).getTime()) : '—'),
                  },
                  { key: 'when', header: 'When', align: 'right', mono: true, render: (r) => ago(r.startedAt ?? r.createdAt) },
                ]}
              />
            </div>
          </>
        )}
      </PageBody>
    </Page>
  );
}
