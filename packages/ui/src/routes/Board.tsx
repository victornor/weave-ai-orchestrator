import { useEffect, useMemo, useState } from 'react';
import { useSearch } from '@tanstack/react-router';
import type { Ticket, TicketStatus } from '@agent-conductor/shared';
import { TICKET_KINDS, TICKET_PRIORITIES, TICKET_STATUSES, ticketUiStatus } from '@agent-conductor/shared';
import { Page, PageBody, PageHeader } from '../components/Page';
import { Segmented } from '../components/Tabs';
import { OutcomeChip, TicketCard, TicketRow } from '../components/TicketCard';
import { SkeletonRows } from '../components/Skeleton';
import { EmptyState, ErrorState } from '../components/States';
import { Table } from '../components/Table';
import { StatusGlyph, Badge } from '../components/StatusGlyph';
import { Button } from '../components/Button';
import { MergeQueuePanel } from '../components/MergeQueue';
import { useDecisions, useMergeQueue, useProjects, useRoles, useTickets, useWorkers, useWorkspaceSummary } from '../api/hooks';
import { useWs } from '../api/context';
import { useGo } from '../app/link';
import type { FinishedMode } from '../lib/board';
import {
  filterTickets,
  finishedModeFromSearch,
  finishedModeSearch,
  foldBoard,
  isFolded,
  liveWorkersByTicket,
  recentlyFinished,
  ticketBoardStatus,
} from '../lib/board';
import { useListNav } from '../lib/hotkeys';
import { ago, statusText } from '../lib/format';
import { cx } from '../lib/cx';
import { isAutoApproving } from '../lib/yolo';

type View = 'kanban' | 'table';

export function BoardRoute(): React.ReactElement {
  const ws = useWs();
  const go = useGo();
  const search = useSearch({ strict: false }) as Record<string, string | undefined>;
  const [view, setView] = useState<View>('kanban');
  // The Done column is on by default, showing what landed recently; `?done=` keeps the choice in
  // the URL, and `1` still means the whole terminal history it always did.
  const [finished, setFinished] = useState<FinishedMode>(finishedModeFromSearch(search['done']));
  const [project, setProject] = useState<string | undefined>(search['project']);
  // The sidebar links to /board?project=…; a second click on another project must re-filter, not be ignored.
  useEffect(() => { setProject(search['project']); }, [search['project']]);
  const [role, setRole] = useState<string | undefined>();
  const [kind, setKind] = useState<string | undefined>();
  const [priority, setPriority] = useState<string | undefined>();
  const [status, setStatus] = useState<TicketStatus | undefined>();

  const tickets = useTickets({ limit: 300 });
  // Finished tickets come from their own query: folded into the 300 active ones they would be
  // ordered by ticket number, and a busy project would push what landed today off the end.
  const finishedTickets = useTickets({ status: 'done,cancelled', limit: 100, sort: 'finished' }, { enabled: finished !== 'hide' });
  const projects = useProjects();
  const roles = useRoles();
  // Worker liveness is what the columns are really about; the worker events the stream already
  // tracks invalidate this query, so a spawn or a retirement re-folds the board on its own.
  const workers = useWorkers({});
  // The merge queue is per project, so it is shown once the board is filtered to one (PLAN §11.4).
  const mergeQueue = useMergeQueue(project);
  // A ticket whose open approval the daemon will grant is not waiting on the human (PLAN §15).
  const openDecisions = useDecisions({ status: 'open', owner: 'human' });
  const summary = useWorkspaceSummary();
  const autoApproving = useMemo(() => {
    const byId = new Map((tickets.data ?? []).map((t) => [t.id, t]));
    const ids = new Set<string>();
    for (const d of openDecisions.data ?? []) {
      const t = d.ticketId ? byId.get(d.ticketId) : undefined;
      if (t && isAutoApproving(d, summary.data?.config, projects.data?.find((p) => p.id === t.projectId))) ids.add(t.id);
    }
    return ids;
  }, [openDecisions.data, tickets.data, projects.data, summary.data]);

  // `recent` is a window on what the query returned; `all` is everything it returned.
  const shownFinished = useMemo(() => {
    if (finished === 'hide') return [];
    const all = finishedTickets.data ?? [];
    return finished === 'all' ? all : recentlyFinished(all);
  }, [finished, finishedTickets.data]);
  const filtered = useMemo(
    () => filterTickets([...(tickets.data ?? []), ...shownFinished], { project, role, kind, priority, status }),
    [tickets.data, shownFinished, project, role, kind, priority, status],
  );
  const live = useMemo(() => liveWorkersByTicket(workers.data ?? []), [workers.data]);
  const columns = useMemo(
    () => foldBoard(filtered, live).filter((c) => finished !== 'hide' || c.key !== 'done'),
    [filtered, live, finished],
  );
  const hasFinished = useMemo(() => filtered.some((t) => t.status === 'done' || t.status === 'cancelled'), [filtered]);

  const chooseFinished = (mode: FinishedMode): void => {
    setFinished(mode);
    go('/w/$ws/board', { params: { ws }, search: { ...search, done: finishedModeSearch(mode) }, replace: true });
  };

  const nav = useListNav(filtered.length, {
    onOpen: (i) => {
      const t = filtered[i];
      if (t) go('/w/$ws/tickets/$ticketId', { params: { ws, ticketId: t.identifier } });
    },
  });

  const open = (t: Ticket): void => go('/w/$ws/tickets/$ticketId', { params: { ws, ticketId: t.identifier } });

  const filters = (
    <div className="flex flex-wrap items-center gap-1.5">
      <Select label="project" value={project} onChange={setProject} options={(projects.data ?? []).map((p) => ({ value: p.id, label: p.slug }))} />
      <Select label="role" value={role} onChange={setRole} options={(roles.data ?? []).map((r) => ({ value: r.id, label: r.name }))} />
      <Select label="kind" value={kind} onChange={setKind} options={TICKET_KINDS.map((k) => ({ value: k, label: k }))} />
      <Select label="priority" value={priority} onChange={setPriority} options={TICKET_PRIORITIES.map((p) => ({ value: p, label: p }))} />
      <span className="ac-mono ml-1 hidden text-nano text-text-4 md:inline">c new · j/k move · ⏎ open</span>
    </div>
  );

  return (
    <Page>
      <PageHeader
        title="Board"
        actions={
          <div className="flex items-center gap-2">
            <span className="hidden text-micro text-text-3 md:inline">Finished</span>
            <Segmented
              ariaLabel="Finished tickets"
              options={[
                { value: 'recent', label: 'Recent' },
                { value: 'all', label: 'All' },
                { value: 'hide', label: 'Hidden' },
              ]}
              value={finished}
              onChange={chooseFinished}
            />
            <Segmented
              className="hidden md:flex"
              ariaLabel="View"
              options={[
                { value: 'kanban', label: 'Kanban' },
                { value: 'table', label: 'Table' },
              ]}
              value={view}
              onChange={setView}
            />
            <Button variant="ghost" size="sm" onClick={() => go('/w/$ws/chat', { params: { ws } })} kbd="c">
              New
            </Button>
          </div>
        }
      />

      <div className="flex-none border-b border-line-1 px-4 py-2 md:px-5">
        {/* phone: status filter + list */}
        <div className="flex gap-1.5 overflow-x-auto md:hidden">
          <StatusPill active={!status} label="all" onClick={() => setStatus(undefined)} />
          {TICKET_STATUSES.map((s) => (
            <StatusPill key={s} active={status === s} label={statusText(s)} status={s} onClick={() => setStatus(s)} />
          ))}
        </div>
        <div className="hidden md:block">{filters}</div>
      </div>

      <PageBody>
        {mergeQueue.data ? (
          <MergeQueuePanel
            className="m-4 mb-0"
            queue={mergeQueue.data}
            onOpen={(e) => go('/w/$ws/tickets/$ticketId', { params: { ws, ticketId: e.identifier } })}
          />
        ) : null}
        {tickets.isLoading ? (
          <SkeletonRows rows={7} />
        ) : tickets.isError ? (
          <ErrorState className="m-4" code="BOARD_QUERY_FAILED" message="The ticket query failed." onRetry={() => void tickets.refetch()} />
        ) : filtered.length === 0 ? (
          <div className="p-6">
            <EmptyState
              title={project ? 'No tickets in this project yet.' : 'No tickets yet.'}
              detail="Ask the conductor for something and it files the ticket."
              action={
                <Button variant="secondary" onClick={() => go('/w/$ws/chat', { params: { ws } })}>
                  Create ticket
                </Button>
              }
            />
          </div>
        ) : (
          <>
            {/* phone list */}
            <div className="md:hidden">
              {filtered.map((t, i) => (
                <TicketRow key={t.id} ticket={t} working={live.has(t.id)} workerName={live.get(t.id)?.name} autoApproving={autoApproving.has(t.id)} selected={i === nav.index} onOpen={() => open(t)} />
              ))}
            </div>

            {/* desktop */}
            <div className="hidden h-full md:block">
              {view === 'kanban' ? (
                <div className="flex h-full gap-px overflow-x-auto bg-line-1">
                  {columns.map((c) => (
                    <section key={c.key} className="flex min-w-56 flex-1 flex-col bg-bg-0">
                      <header className="flex items-center gap-2 px-3 pb-2.5 pt-3">
                        <StatusGlyph status={c.status} size="xs" />
                        <h2 className="text-micro font-medium text-text-soft">{c.label}</h2>
                        <span className="ac-mono text-nano text-text-4">{c.items.length}</span>
                        {c.key === 'done' && finished === 'recent' ? (
                          <>
                            <div className="flex-1" />
                            <button
                              type="button"
                              onClick={() => chooseFinished('all')}
                              className="text-nano text-text-3 transition-colors duration-(--dur-fast) ease-ac hover:text-accent-link"
                            >
                              show all
                            </button>
                          </>
                        ) : null}
                      </header>
                      <div className="ac-scroll flex flex-col gap-2 px-2 pb-4">
                        {c.items.map((t) => (
                          <TicketCard key={t.id} ticket={t} working={live.has(t.id)} workerName={live.get(t.id)?.name} autoApproving={autoApproving.has(t.id)} onOpen={() => open(t)} />
                        ))}
                      </div>
                    </section>
                  ))}
                </div>
              ) : (
                <Table
                  rows={filtered}
                  rowKey={(t) => t.id}
                  onRowClick={open}
                  activeIndex={nav.index}
                  columns={[
                    {
                      key: 'status',
                      header: 'Status',
                      width: '9rem',
                      render: (t) => (
                        <span className="flex items-center gap-2">
                          <StatusGlyph status={ticketBoardStatus(t.status, { live: live.has(t.id) })} size="xs" />
                          <span className="ac-mono text-micro">{statusText(t.status)}</span>
                        </span>
                      ),
                    },
                    { key: 'id', header: 'Ticket', width: '7rem', mono: true, render: (t) => t.identifier },
                    { key: 'title', header: 'Title', render: (t) => <span className="text-text-1">{t.title}</span> },
                    { key: 'kind', header: 'Kind', width: '6rem', render: (t) => <Badge>{t.kind}</Badge> },
                    { key: 'priority', header: 'Priority', width: '6rem', mono: true, render: (t) => t.priority },
                    ...(hasFinished ? [{ key: 'outcome', header: 'Outcome', width: '9rem', render: (t: Ticket) => <OutcomeChip ticket={t} /> }] : []),
                    { key: 'age', header: 'Age', width: '5rem', align: 'right', mono: true, render: (t) => ago(t.updatedAt) },
                  ]}
                />
              )}
            </div>
          </>
        )}
      </PageBody>
    </Page>
  );
}

function StatusPill({ label, status, active, onClick }: { label: string; status?: TicketStatus; active: boolean; onClick: () => void }): React.ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cx(
        'ac-mono flex flex-none items-center gap-1.5 rounded-pill border px-2.5 py-1 text-micro',
        active ? 'border-accent-edge bg-accent-tint text-accent-link' : 'border-line-2 text-text-3',
      )}
    >
      {status ? <StatusGlyph status={ticketUiStatus(status)} size="xs" /> : null}
      {label}
      {status && isFolded(status) ? <span className="text-text-4">·</span> : null}
    </button>
  );
}

function Select({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string | undefined;
  onChange: (v: string | undefined) => void;
  options: Array<{ value: string; label: string }>;
}): React.ReactElement {
  return (
    <label className={cx('flex h-7 items-center gap-1.5 rounded-r4 border px-2', value ? 'border-accent-edge bg-accent-tint' : 'border-line-2')}>
      <span className={cx('text-micro', value ? 'text-accent-link' : 'text-text-3')}>{label}</span>
      <select
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value || undefined)}
        aria-label={`Filter by ${label}`}
        className="ac-mono bg-transparent text-micro text-text-soft outline-none"
      >
        <option value="">any</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
