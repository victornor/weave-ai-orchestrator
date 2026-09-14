/**
 * V2's Incidents screen (web-v2/incidents, VS-350, HANDOFF §11).
 *
 * One flat list with `All · Open · Resolved`, cards carrying a pulsing dot while open, and an
 * expansion that shows what failed, the evidence block and the note that the weaver handles it. It is
 * a record you read: no Retry or Resolve controls, no error-code field.
 */
import { useMemo, useState } from 'react';
import { useIncidents, useWorkspaces } from '../api/hooks';
import { ago } from '../lib/format';
import { cx } from '../lib/cx';
import { SkeletonCards } from '../components/Skeleton';
import { EmptyState, ErrorState } from '../components/States';
import { V2Page } from './V2Page';

type IncidentFilter = 'all' | 'open' | 'resolved';

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

export function V2IncidentsPage(): React.ReactElement {
  return (
    <V2Page title="Incidents">
      <IncidentsBody />
    </V2Page>
  );
}

export function IncidentsBody(): React.ReactElement {
  const incidents = useIncidents();
  const workspaces = useWorkspaces();
  const [filter, setFilter] = useState<IncidentFilter>('all');
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());

  const all = incidents.data?.items ?? [];
  const filtered = useMemo(
    () => all.filter((i) => (filter === 'all' ? true : filter === 'open' ? i.resolvedAt === null : i.resolvedAt !== null)),
    [all, filter],
  );
  // An incident carries the workspace's internal id (minted from the run token), while the workspaces
  // list sends the slug as `id` and the row's ULID as `internalId` — match whichever it carries, and
  // fall back to a neutral label rather than the raw id (VS-403).
  const scopeName = (workspaceId: string | null): string => {
    if (!workspaceId) return 'Daemon';
    const ws = workspaces.data?.find((w) => w.internalId === workspaceId || w.id === workspaceId);
    return ws?.name ?? 'Unknown workspace';
  };
  const toggle = (id: string): void => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  if (incidents.isLoading || workspaces.isLoading) return <SkeletonCards count={2} />;
  if (incidents.isError) return <ErrorState code="INCIDENTS_QUERY_FAILED" message="Could not load incidents." onRetry={() => void incidents.refetch()} />;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-1.5 border-b border-line-1 px-4 py-2" data-v2-incidents-filters>
        <Chip label="All" active={filter === 'all'} onClick={() => setFilter('all')} />
        <Chip label="Open" active={filter === 'open'} onClick={() => setFilter('open')} />
        <Chip label="Resolved" active={filter === 'resolved'} onClick={() => setFilter('resolved')} />
        <span className="ml-auto ac-mono text-micro text-text-3" aria-live="polite">
          {filtered.length} shown
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {all.length === 0 ? (
          <EmptyState title="No incidents." detail="An agent files one here when something breaks." />
        ) : filtered.length === 0 ? (
          <EmptyState title="Nothing in this filter." detail="Choose another state." />
        ) : (
          <div className="mx-auto flex max-w-3xl flex-col gap-2.5">
            {filtered.map((i) => {
              const open = i.resolvedAt === null;
              const isOpen = expanded.has(i.id);
              return (
                <div key={i.id} className="v2-anim-rise v2-card overflow-hidden" data-v2-incident={i.id}>
                  <button type="button" onClick={() => toggle(i.id)} className="flex w-full items-start gap-3 px-4 py-3.5 text-left">
                    <span
                      className={cx('mt-1 size-2 flex-none rounded-pill', open ? 'bg-blocked motion-safe:animate-[ac-pulse_1.6s_ease-in-out_infinite]' : 'bg-idle')}
                      data-pulse={open ? 'true' : 'false'}
                      aria-hidden
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block text-ui font-medium leading-snug text-text-strong">{i.title}</span>
                      <span className="mt-1 flex flex-wrap items-center gap-2">
                        <span className={cx('ac-mono text-nano', open ? 'text-blocked' : 'text-text-3')}>{open ? 'open' : 'resolved'}</span>
                        <span className="ac-mono text-nano text-text-3">{ago(i.createdAt)}</span>
                        <span className="ac-mono text-nano text-text-3">{scopeName(i.workspaceId)}</span>
                      </span>
                    </span>
                    <span className={cx('mt-1 flex-none text-text-3 transition-transform', isOpen ? 'rotate-180' : 'rotate-0')} aria-hidden>
                      ▾
                    </span>
                  </button>
                  {isOpen ? (
                    <div className="v2-anim-fade px-4 pb-4" data-v2-incident-detail>
                      <div className="mb-3.5 h-px bg-line-1" />
                      <div className="mb-1.5 text-meta leading-relaxed text-text-body" data-v2-incident-what>
                        {i.whatFailed}
                      </div>
                      {i.tryingToDo ? <div className="mb-3 text-micro text-text-3">Trying to: {i.tryingToDo}</div> : null}
                      {i.evidence ? (
                        <pre className="ac-mono wv-scroll overflow-x-auto whitespace-pre rounded-r4 border border-line-1 bg-bg-2 px-3 py-2.5 text-nano leading-relaxed text-text-2" data-v2-incident-evidence>
                          {i.evidence}
                        </pre>
                      ) : null}
                      {open ? (
                        <p className="mt-3 text-micro text-text-3">The weaver is handling this. It will tell you in chat if it needs a decision.</p>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
