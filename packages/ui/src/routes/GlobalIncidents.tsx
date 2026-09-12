/**
 * Daemon-wide Incidents (VS-174): system reports agents filed through weave_incident.
 */
import { useState } from 'react';
import type { Incident, IncidentReporterKind } from '@weave-ai/shared';
import { Page, PageBody, PageHeader } from '../components/Page';
import { Badge } from '../components/StatusGlyph';
import { SkeletonRows } from '../components/Skeleton';
import { EmptyState, ErrorState } from '../components/States';
import { useIncidents, useWorkspaces } from '../api/hooks';
import { useGo, useSearchParams } from '../app/link';
import { cx } from '../lib/cx';

const FILTERS: Array<{ key: 'all' | IncidentReporterKind; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'weaver', label: 'Weaver' },
  { key: 'worker', label: 'Worker' },
];

function reporterOf(search: string | undefined): IncidentReporterKind | undefined {
  return search === 'weaver' || search === 'worker' ? search : undefined;
}

function IncidentRow({
  incident,
  workspaceName,
}: {
  incident: Incident;
  workspaceName: string | null;
}): React.ReactElement {
  const [open, setOpen] = useState(false);
  return (
    <article className="border-b border-line-1">
      <button
        type="button"
        className="flex w-full items-center gap-2.5 px-4 py-3 text-left hover:bg-bg-2"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="min-w-0 flex-1 truncate text-ui text-text-1">{incident.title}</span>
        <Badge tone={incident.reporterKind === 'weaver' ? 'accent' : 'neutral'}>{incident.reporterKind}</Badge>
        {workspaceName ? <span className="hidden text-micro text-text-3 sm:inline">{workspaceName}</span> : null}
        <time className="ac-mono shrink-0 text-nano text-text-3" dateTime={incident.createdAt}>
          {incident.createdAt.replace('T', ' ').replace(/\.\d+Z$/, 'Z')}
        </time>
      </button>
      {open ? (
        <div className="flex flex-col gap-2 px-4 pb-3 text-meta text-text-2">
          <p><span className="text-text-3">What failed. </span>{incident.whatFailed}</p>
          <p><span className="text-text-3">Trying to do. </span>{incident.tryingToDo}</p>
          {incident.evidence ? <pre className="ac-mono overflow-x-auto whitespace-pre-wrap text-nano text-text-3">{incident.evidence}</pre> : null}
        </div>
      ) : null}
    </article>
  );
}

export function GlobalIncidentsRoute(): React.ReactElement {
  const go = useGo();
  const search = useSearchParams();
  const reporter = reporterOf(search.reporter);
  const list = useIncidents(reporter);
  const workspaces = useWorkspaces();
  const nameOf = (id: string | null): string | null => {
    if (!id) return null;
    return workspaces.data?.find((w) => w.id === id)?.name ?? id;
  };

  const setFilter = (key: 'all' | IncidentReporterKind): void => {
    go('/incidents', { search: key === 'all' ? {} : { reporter: key }, replace: true });
  };

  const items = list.data?.items ?? [];
  const emptyTitle = reporter === 'weaver'
    ? 'No weaver incidents.'
    : reporter === 'worker'
      ? 'No worker incidents.'
      : 'No incidents have been filed.';

  return (
    <Page>
      <PageHeader
        title="Incidents"
        meta={list.data && list.data.total ? `${list.data.total}` : undefined}
        tabs={(
          <div className="flex gap-1 px-4 pb-2 md:px-5" role="group" aria-label="Reporter">
            {FILTERS.map((f) => {
              const current = (reporter ?? 'all') === f.key;
              return (
                <button
                  key={f.key}
                  type="button"
                  aria-pressed={current}
                  className={cx(
                    'h-7 rounded-r4 px-2.5 text-meta',
                    current ? 'bg-bg-3 text-text-1' : 'text-text-3 hover:bg-bg-2',
                  )}
                  onClick={() => setFilter(f.key)}
                >
                  {f.label}
                </button>
              );
            })}
          </div>
        )}
      />
      <PageBody>
        {list.isError ? (
          <ErrorState className="m-4 mx-auto max-w-2xl" error={list.error} onRetry={() => void list.refetch()} />
        ) : list.data === undefined ? (
          <SkeletonRows className="mx-auto max-w-2xl" />
        ) : items.length === 0 ? (
          <EmptyState className="m-4 mx-auto max-w-2xl" title={emptyTitle} detail="Agents file these with weave_incident when Weave AI itself fails." />
        ) : (
          <div className="mx-auto max-w-2xl">
            {items.map((incident) => (
              <IncidentRow key={incident.id} incident={incident} workspaceName={nameOf(incident.workspaceId)} />
            ))}
          </div>
        )}
      </PageBody>
    </Page>
  );
}
