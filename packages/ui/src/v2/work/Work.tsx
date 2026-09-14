/**
 * V2's Work screen (VS-346): the workspace's tickets as a kanban or a table, folded through the V2
 * column rule in `board.ts`. Data comes from the same queries V1's board uses; the layout is V2's
 * (HANDOFF §7): narrow empty columns, no status glyph on a card or a column header, the project tag
 * top-right, and the worker role on its own bottom row under a hairline.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { openspecArchive, projectLabel, TICKET_KINDS, TICKET_PRIORITIES, type Ticket, type TicketKind, type TicketPriority, type WorkerModelOption } from '@weave-ai/shared';
import { workerPauseDetail } from '@weave-ai/render';
import { V2Page } from '../V2Page';
import { Button } from '../../components/Button';
import { StatusGlyph, Badge } from '../../components/StatusGlyph';
import { TestTally } from '../../components/TicketCard';
import { LiveActivityLine } from '../../components/LiveActivityLine';
import { WorkerModelTag } from '../../components/WorkerModelTag';
import { SkeletonRows } from '../../components/Skeleton';
import { EmptyState, ErrorState } from '../../components/States';
import { useWs } from '../../api/context';
import { useSearchParams, useGo } from '../../app/link';
import {
  useCreateTicket,
  useDecisions,
  useModels,
  useProjects,
  useRoles,
  useRuns,
  useTickets,
  useWorkers,
  type WorkerListItem,
} from '../../api/hooks';
import { useWorkerActivity } from '../../api/workerActivity';
import { filterTickets, finishedModeFromSearch, mergeStrip, pausedWorkersByTicket, type FinishedMode } from '../../lib/board';
import { lastLinesByAgent } from '../../lib/projectOverview';
import { activityLine, mergeWorkerActivity } from '../../lib/workerActivity';
import { projectColorVar } from '../../lib/projectColor';
import { ago, statusText } from '../../lib/format';
import { cx } from '../../lib/cx';
import {
  foldV2Board,
  highlightSegments,
  liveWorkersByTicket,
  needsYouTicketIds,
  v2ColumnFor,
  v2ColumnStatusOf,
  v2ShownFinished,
  type V2BoardColumn,
} from './board';

type WorkView = 'kanban' | 'table';

/** Typing pauses before the search reaches the daemon (VS-379), matching the thread search's 250ms. */
const SEARCH_DEBOUNCE_MS = 250;

interface WorkRow {
  ticket: Ticket;
  projectLabel: string | null;
  projectColor: string | null;
  workerName: string | null;
  needsYou: boolean;
  live: boolean;
  /** The line under the worker: the worker's current activity, its last run summary, or "Working". */
  line: { label: string; since: string | null } | null;
  /** The most recent parsed test tally, when the daemon has one. */
  tests: { passed: number; total: number } | null;
  /** Why the ticket's worker is paused, when one is and it is not live. */
  pausedFor: string | null;
}

export function V2WorkScreen(): React.ReactElement {
  const ws = useWs();
  const go = useGo();
  const search = useSearchParams();
  const [view, setView] = useState<WorkView>('kanban');
  const [finished, setFinished] = useState<FinishedMode>(finishedModeFromSearch(search['done']));
  const [project, setProject] = useState<string | undefined>(search['project']);
  const [role, setRole] = useState<string | undefined>(undefined);
  const [kind, setKind] = useState<string | undefined>(undefined);
  const [priority, setPriority] = useState<string | undefined>(undefined);
  const [creating, setCreating] = useState(false);
  const [q, setQ] = useState<string>(search['q'] ?? '');
  const [debouncedQ, setDebouncedQ] = useState<string>(search['q'] ?? '');
  const searchInput = useRef<HTMLInputElement>(null);

  const tickets = useTickets({ limit: 300 });
  const finishedTickets = useTickets({ status: 'done,cancelled', limit: 100, sort: 'finished' }, { enabled: finished !== 'hide' });
  const projects = useProjects();
  const roles = useRoles();
  const workers = useWorkers({});
  // The live activity summary the daemon pushes on the workspace stream (VS-328), plus the runs the
  // screen already needs for the between-turns line (VS-368).
  const activity = useWorkerActivity();
  const runs = useRuns({ limit: 100 });
  const decisions = useDecisions({ status: 'open', owner: 'human' });
  const models = useModels();
  const workerOptions = models.data?.workerOptions;

  const activeQuery = debouncedQ.trim();
  const searching = activeQuery.length > 0;
  // The daemon's list search is `title LIKE ? OR description LIKE ? OR identifier LIKE ?`, so a
  // match in a description — or on a ticket outside the loaded page — is found here that the
  // client over `tickets.data` alone could never see. Finished tickets are included while
  // searching: looking for old work is the main reason to search at all.
  const searchTickets = useTickets(
    { search: activeQuery, includeTerminal: true, limit: 300, project },
    { enabled: searching },
  );
  // Debounce the typing; the URL keeps the raw query so a fast typist's back/forward is faithful.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [q]);

  const projectList = projects.data ?? [];
  const siblingIds = useMemo(() => projectList.map((p) => p.id), [projectList]);

  const shownFinished = useMemo(
    () => v2ShownFinished(finishedTickets.data ?? [], finished),
    [finished, finishedTickets.data],
  );
  const allTickets = useMemo(() => [...(tickets.data ?? []), ...shownFinished], [tickets.data, shownFinished]);
  const sourceTickets = searching ? (searchTickets.data ?? []) : allTickets;

  const needsYou = useMemo(() => {
    const byId = new Map(sourceTickets.map((t) => [t.id, t]));
    return needsYouTicketIds(decisions.data ?? [], byId, projectList);
  }, [decisions.data, sourceTickets, projectList]);

  const live = useMemo(() => liveWorkersByTicket(workers.data ?? []), [workers.data]);
  // `paused` is never in `live` (VS-137), so a paused ticket's reason needs this separate lookup.
  const paused = useMemo(() => pausedWorkersByTicket(workers.data ?? []), [workers.data]);
  const runLines = useMemo(() => lastLinesByAgent(runs.data ?? []), [runs.data]);
  const workerNameByTicket = useMemo(() => {
    const m = new Map<string, string>();
    for (const w of workers.data ?? []) if (w.ticketId) m.set(w.ticketId, w.name);
    return m;
  }, [workers.data]);

  const filtered = useMemo(
    () => filterTickets(sourceTickets, { project, role, kind, priority }),
    [sourceTickets, project, role, kind, priority],
  );

  const rows = useMemo<WorkRow[]>(
    () =>
      filtered.map((t) => {
        const p = projectList.find((x) => x.id === t.projectId) ?? null;
        const liveWorker = live.get(t.id) as WorkerListItem | undefined;
        const pausedWorker = paused.get(t.id);
        const summary = mergeWorkerActivity(liveWorker, activity);
        const runLine = liveWorker ? runLines.get(liveWorker.id) ?? null : null;
        // A live worker always carries a line: its current activity, else its last run summary, else
        // a bare "Working" — so the amber working mark is never missing on a running ticket.
        const line = liveWorker ? activityLine(summary, runLine) ?? { label: 'Working', since: null } : null;
        return {
          ticket: t,
          projectLabel: p ? projectLabel(p) : null,
          projectColor: p ? projectColorVar(p.id, siblingIds) : null,
          workerName: liveWorker?.name ?? workerNameByTicket.get(t.id) ?? null,
          needsYou: needsYou.has(t.id),
          live: live.has(t.id),
          line,
          tests: summary?.tests ?? null,
          pausedFor: !liveWorker && pausedWorker ? workerPauseDetail(pausedWorker)?.summary ?? null : null,
        };
      }),
    [filtered, projectList, live, paused, activity, runLines, workerNameByTicket, needsYou, siblingIds],
  );

  const columns = useMemo(
    () => foldV2Board(filtered, { live, needsYou }),
    [filtered, live, needsYou],
  );

  const strip = useMemo(() => mergeStrip(tickets.data ?? []), [tickets.data]);
  const boardQuery = searching ? searchTickets : tickets;

  const openTicket = (identifier: string): void =>
    go('/v2/w/$ws/tickets/$ticketId', { params: { ws, ticketId: identifier } });

  const chooseFinished = (mode: FinishedMode): void => setFinished(mode);

  /** Keep `?q=` current without stacking history, so the query survives reload and back/forward. */
  const commitQuery = (value: string): void => {
    setQ(value);
    go('/v2/w/$ws/work', { params: { ws }, search: { ...search, q: value.trim() || undefined }, replace: true });
  };
  const clearQuery = (): void => commitQuery('');

  // `/` focuses the field from anywhere on the screen, the way a search-first board expects.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return;
      const el = document.activeElement as HTMLElement | null;
      const tag = el?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el?.isContentEditable) return;
      e.preventDefault();
      searchInput.current?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <V2Page title="Work">
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex flex-none flex-wrap items-center gap-2 border-b border-line-1 px-4 py-2">
          <span className="text-micro text-text-3">Finished</span>
          <Segmented
            ariaLabel="Finished tickets"
            value={finished}
            onChange={chooseFinished}
            options={[
              { value: 'recent', label: 'Recent' },
              { value: 'all', label: 'All' },
              { value: 'hide', label: 'Hidden' },
            ]}
          />
          <Segmented
            ariaLabel="View"
            value={view}
            onChange={setView}
            options={[
              { value: 'kanban', label: 'Kanban' },
              { value: 'table', label: 'Table' },
            ]}
          />
          <div className="flex-1" />
          <Button size="sm" variant="ghost" onClick={() => setCreating(true)}>
            New ticket
          </Button>
        </div>

        <div className="flex flex-none flex-wrap items-center gap-1.5 border-b border-line-1 px-4 py-2">
          <SearchField
            inputRef={searchInput}
            value={q}
            onChange={commitQuery}
            onClear={clearQuery}
          />
          <FilterSelect
            label="project"
            value={project}
            onChange={setProject}
            options={projectList.map((p) => ({ value: p.id, label: projectLabel(p) }))}
          />
          <FilterSelect
            label="role"
            value={role}
            onChange={setRole}
            options={(roles.data ?? []).map((r) => ({ value: r.id, label: r.name }))}
          />
          <FilterSelect
            label="kind"
            value={kind}
            onChange={setKind}
            options={TICKET_KINDS.map((k) => ({ value: k, label: k }))}
          />
          <FilterSelect
            label="priority"
            value={priority}
            onChange={setPriority}
            options={TICKET_PRIORITIES.map((p) => ({ value: p, label: p }))}
          />
          {searching ? (
            <span className="ac-mono ml-1 text-nano text-text-3" data-v2-search-count>
              {filtered.length === 1 ? '1 ticket matches' : `${filtered.length} tickets match`}
            </span>
          ) : null}
        </div>

        <div className="flex flex-none items-center gap-2 border-b border-line-1 px-4 py-2" data-v2-merge-strip>
          <span className={cx('text-micro font-medium', strip.landing + strip.waiting > 0 ? 'text-text-2' : 'text-text-3')}>
            Merge queue
          </span>
          <span className="ac-mono text-nano text-text-3">
            {strip.landing + strip.waiting > 0 ? `${strip.landing} landing · ${strip.waiting} waiting` : 'nothing landing'}
          </span>
        </div>

        {boardQuery.isLoading ? (
          <div className="p-4">
            <SkeletonRows rows={7} />
          </div>
        ) : boardQuery.isError ? (
          <div className="p-4">
            <ErrorState
              code="WORK_QUERY_FAILED"
              message="The ticket query failed."
              onRetry={() => void boardQuery.refetch()}
            />
          </div>
        ) : rows.length === 0 ? (
          <div className="p-6">
            {searching ? (
              <EmptyState
                title={`No tickets match “${activeQuery}”.`}
                detail="Search runs over titles, descriptions and identifiers, finished tickets included."
                action={
                  <Button variant="secondary" onClick={clearQuery}>
                    Clear search
                  </Button>
                }
              />
            ) : (
              <EmptyState
                title={project ? 'No tickets in this project yet.' : 'No tickets yet.'}
                detail="Ask the weaver for something and it files the ticket."
                action={
                  <Button variant="secondary" onClick={() => setCreating(true)}>
                    New ticket
                  </Button>
                }
              />
            )}
          </div>
        ) : (
          <>
            {/* Phone: a list, glyph on each row (HANDOFF §7). */}
            <div className="min-h-0 flex-1 overflow-y-auto md:hidden" data-v2-work-phone>
              {rows.map((r) => (
                <PhoneRow key={r.ticket.id} row={r} query={activeQuery} onOpen={() => openTicket(r.ticket.identifier)} />
              ))}
            </div>

            <div className="hidden min-h-0 flex-1 md:block">
              {view === 'kanban' ? (
                <div className="flex h-full min-h-0 gap-px overflow-x-auto bg-line-1" data-v2-work-kanban>
                  {columns.map((c) => (
                    <KanbanColumn
                      key={c.key}
                      column={c}
                      rows={rowsByTicket(rows, c)}
                      workerOptions={workerOptions}
                      query={activeQuery}
                      onOpen={openTicket}
                    />
                  ))}
                </div>
              ) : (
                <WorkTable rows={rows} columns={columns} workerOptions={workerOptions} query={activeQuery} onOpen={openTicket} />
              )}
            </div>
          </>
        )}
      </div>
      {creating ? <NewTicketDialog onClose={() => setCreating(false)} onCreated={(t) => openTicket(t.identifier)} /> : null}
    </V2Page>
  );
}

function rowsByTicket(rows: readonly WorkRow[], column: V2BoardColumn<Ticket>): WorkRow[] {
  const ids = new Set(column.items.map((t) => t.id));
  return rows.filter((r) => ids.has(r.ticket.id));
}

function Segmented<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
}: {
  options: ReadonlyArray<{ value: T; label: string }>;
  value: T;
  onChange: (v: T) => void;
  ariaLabel: string;
}): React.ReactElement {
  return (
    <div role="radiogroup" aria-label={ariaLabel} className="flex gap-px rounded-r4 border border-line-1 bg-bg-2 p-px">
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(o.value)}
            className={cx(
              'rounded-[3px] px-2 py-1 text-micro transition-colors duration-(--dur-fast) ease-ac',
              on ? 'bg-bg-0 text-text-1' : 'text-text-3 hover:text-text-2',
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function FilterSelect({
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
    <label
      className={cx(
        'flex h-7 items-center gap-1.5 rounded-r4 border px-2',
        value ? 'border-accent-edge bg-accent-tint' : 'border-line-2',
      )}
    >
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

function SearchField({
  inputRef,
  value,
  onChange,
  onClear,
}: {
  inputRef: React.RefObject<HTMLInputElement | null>;
  value: string;
  onChange: (v: string) => void;
  onClear: () => void;
}): React.ReactElement {
  return (
    <label
      className={cx(
        'flex h-7 min-w-[184px] flex-1 items-center gap-1.5 rounded-r4 border px-2 sm:flex-none',
        value ? 'border-accent-edge bg-accent-tint' : 'border-line-2',
      )}
      data-v2-work-search
    >
      <span aria-hidden className={cx('ac-mono text-micro', value ? 'text-accent-link' : 'text-text-3')}>
        ⌕
      </span>
      <input
        ref={inputRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            onClear();
          }
        }}
        placeholder="Search tickets…"
        aria-label="Search tickets"
        className="ac-mono min-w-0 flex-1 bg-transparent text-micro text-text-1 outline-none placeholder:text-text-4"
      />
      {value ? (
        <button
          type="button"
          aria-label="Clear search"
          onClick={onClear}
          className="ac-mono flex-none text-micro text-text-3 hover:text-text-1"
        >
          ×
        </button>
      ) : null}
    </label>
  );
}

function KanbanColumn({
  column,
  rows,
  workerOptions,
  query,
  onOpen,
}: {
  column: V2BoardColumn<Ticket>;
  rows: WorkRow[];
  workerOptions: WorkerModelOption[] | undefined;
  query: string;
  onOpen: (identifier: string) => void;
}): React.ReactElement {
  const empty = rows.length === 0;
  return (
    <section
      data-v2-column={column.key}
      data-empty={empty ? 'true' : undefined}
      style={empty ? { flex: '0 0 108px', minWidth: 108 } : { flex: '1 0 236px', minWidth: 236 }}
      className="flex flex-col border-r border-line-1 bg-bg-0"
    >
      <header className="flex flex-none items-center gap-2 px-3 pb-2 pt-2.5">
        <h2 className="text-micro font-medium text-text-soft">{column.label}</h2>
        <span className="ac-mono text-nano text-text-3" data-count={column.key}>
          {rows.length}
        </span>
      </header>
      <div className="ac-scroll flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-2 pb-4">
        {rows.map((r) => (
          <WorkCard key={r.ticket.id} row={r} workerOptions={workerOptions} query={query} onOpen={() => onOpen(r.ticket.identifier)} />
        ))}
      </div>
    </section>
  );
}

/** The title, with the active search's matches marked. `highlightSegments` never trusts the match. */
function Title({ text, query }: { text: string; query: string }): React.ReactElement {
  return (
    <>
      {highlightSegments(text, query).map((seg, i) =>
        seg.match ? (
          <mark key={i} className="bg-accent/25 px-0.5 text-text-1">
            {seg.text}
          </mark>
        ) : (
          <span key={i}>{seg.text}</span>
        ),
      )}
    </>
  );
}

function WorkCard({
  row,
  workerOptions,
  query,
  onOpen,
}: {
  row: WorkRow;
  workerOptions: WorkerModelOption[] | undefined;
  query: string;
  onOpen: () => void;
}): React.ReactElement {
  const { ticket } = row;
  const archive = openspecArchive(ticket);
  const folded = v2ColumnFor(ticket.status, { live: row.live, needsYou: row.needsYou }) !== (ticket.status as string);
  return (
    <button
      type="button"
      onClick={onOpen}
      data-v2-card={ticket.identifier}
      className="v2-card w-full p-2.5 text-left transition-colors duration-(--dur-fast) ease-ac hover:bg-bg-2"
    >
      <div className="mb-1.5 flex items-center gap-2">
        <span className="ac-mono text-micro text-text-3">{ticket.identifier}</span>
        {row.projectLabel && row.projectColor ? (
          <span className="v2-tag ml-auto" data-project-color style={{ color: row.projectColor }}>
            {row.projectLabel}
          </span>
        ) : null}
      </div>
      <div className="mb-2 text-ui leading-snug text-text-1">
        <Title text={ticket.title} query={query} />
      </div>
      <LiveActivityLine line={row.line} />
      {row.pausedFor ? (
        <div className="ac-mono ac-truncate mb-2 rounded-r4 bg-bg-2 px-2.5 py-1 text-nano text-text-3" title={row.pausedFor}>
          paused · {row.pausedFor}
        </div>
      ) : null}
      <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
        <span className="v2-tag text-text-3">{ticket.kind}</span>
        <WorkerModelTag ticket={ticket} options={workerOptions} />
        {row.tests ? <TestTally tests={row.tests} /> : null}
        {row.needsYou ? (
          <span className="v2-tag text-needs-you">needs you</span>
        ) : folded ? (
          <span className="v2-tag text-text-3">{statusText(ticket.status)}</span>
        ) : null}
        {archive?.state === 'pending' ? (
          <span className="v2-tag text-needs-you" data-v2-archive-pending title={archive.pendingPrUrl ?? undefined}>spec archive pending</span>
        ) : null}
      </div>
      <div className="flex items-baseline gap-2 border-t border-line-1 pt-1.5">
        <span className="min-w-0 flex-1 truncate text-micro text-text-2">{row.workerName ?? 'unassigned'}</span>
        <span className="ac-mono flex-none text-nano text-text-3">{ago(ticket.updatedAt)}</span>
      </div>
    </button>
  );
}

function PhoneRow({ row, query, onOpen }: { row: WorkRow; query: string; onOpen: () => void }): React.ReactElement {
  const { ticket } = row;
  return (
    <button
      type="button"
      onClick={onOpen}
      data-v2-phone-row={ticket.identifier}
      className="flex w-full items-start gap-3 border-b border-line-1 px-4 py-3 text-left hover:bg-bg-1"
    >
      <StatusGlyph status={v2ColumnStatusOf(ticket.status, { needsYou: row.needsYou, live: row.live })} size="sm" className="mt-0.5" />
      <div className="min-w-0 flex-1">
        <div className="mb-1 flex items-center gap-2">
          <span className="ac-mono text-micro text-text-3">{ticket.identifier}</span>
          {row.projectLabel && row.projectColor ? (
            <span className="v2-tag" style={{ color: row.projectColor }}>
              {row.projectLabel}
            </span>
          ) : null}
        </div>
        <div className="mb-1.5 text-body leading-snug text-text-1">
          <Title text={ticket.title} query={query} />
        </div>
        <div className="text-micro text-text-2">{row.workerName ?? 'unassigned'}</div>
        {row.line ? (
          <div data-v2-activity className="ac-mono mt-1 flex items-center gap-1.5 text-nano text-text-2">
            <StatusGlyph status="working" size="xs" pulse className="flex-none" />
            <span className="truncate">{row.line.label}</span>
            {row.tests ? <TestTally tests={row.tests} /> : null}
          </div>
        ) : row.pausedFor ? (
          <div className="ac-mono mt-1 truncate text-nano text-text-3">paused · {row.pausedFor}</div>
        ) : null}
      </div>
      <span className="ac-mono flex-none text-nano text-text-3">{ago(ticket.updatedAt)}</span>
    </button>
  );
}

function WorkTable({
  rows,
  columns,
  workerOptions,
  query,
  onOpen,
}: {
  rows: WorkRow[];
  columns: Array<V2BoardColumn<Ticket>>;
  workerOptions: WorkerModelOption[] | undefined;
  query: string;
  onOpen: (identifier: string) => void;
}): React.ReactElement {
  return (
    <div className="h-full overflow-auto" data-v2-work-table>
      <div className="min-w-[880px]">
        <div className="flex items-center gap-3 border-b border-line-1 px-4 py-2">
          <span className="ac-label flex-none" style={{ width: 92 }}>
            Ticket
          </span>
          <span className="ac-label min-w-0 flex-1">Title</span>
          <span className="ac-label flex-none" style={{ width: 88 }}>
            Kind
          </span>
          <span className="ac-label flex-none" style={{ width: 96 }}>
            Priority
          </span>
          <span className="ac-label flex-none" style={{ width: 160 }}>
            Worker
          </span>
          <span className="ac-label flex-none text-right" style={{ width: 44 }}>
            Age
          </span>
        </div>
        {columns.map((c) => {
          const groupRows = rowsByTicket(rows, c);
          return (
            <div key={c.key} data-v2-table-group={c.key}>
              <div className="flex items-center gap-2 border-b border-line-1 bg-bg-2 px-4 py-1.5">
                <StatusGlyph status={c.status} size="xs" />
                <span className="text-micro font-medium text-text-1">{c.label}</span>
                <span className="ac-mono text-nano text-text-3">{groupRows.length}</span>
              </div>
              {groupRows.map((r) => (
                <button
                  key={r.ticket.id}
                  type="button"
                  onClick={() => onOpen(r.ticket.identifier)}
                  data-v2-table-row={r.ticket.identifier}
                  className="flex w-full items-center gap-3 border-b border-line-1 px-4 py-2 text-left hover:bg-bg-1"
                >
                  <span className="flex flex-none items-center gap-2" style={{ width: 92 }}>
                    <StatusGlyph status={v2ColumnStatusOf(r.ticket.status, { needsYou: r.needsYou, live: r.live })} size="xs" />
                    <span className="ac-mono text-micro text-text-3">{r.ticket.identifier}</span>
                  </span>
                  <div className="min-w-0 flex-1">
                    <span className="block truncate text-ui text-text-1">
                      <Title text={r.ticket.title} query={query} />
                    </span>
                    {r.line ? (
                      <span data-v2-activity className="ac-mono flex items-center gap-1.5 truncate text-nano text-text-2">
                        <StatusGlyph status="working" size="xs" pulse className="flex-none" />
                        <span className="truncate">{r.line.label}</span>
                      </span>
                    ) : r.pausedFor ? (
                      <span className="ac-mono block truncate text-nano text-text-3">paused · {r.pausedFor}</span>
                    ) : null}
                  </div>
                  <span className="flex-none" style={{ width: 88 }}>
                    <Badge>{r.ticket.kind}</Badge>
                    <span className="ml-1.5 inline-block align-middle">
                      <WorkerModelTag ticket={r.ticket} options={workerOptions} />
                    </span>
                  </span>
                  <span className="ac-mono flex-none text-micro text-text-2" style={{ width: 96 }}>
                    {r.ticket.priority}
                  </span>
                  <span className="min-w-0 flex-none truncate text-micro text-text-2" style={{ width: 160 }}>
                    {r.workerName ?? 'unassigned'}
                  </span>
                  <span className="ac-mono flex-none text-right text-nano text-text-3" style={{ width: 44 }}>
                    {ago(r.ticket.updatedAt)}
                  </span>
                </button>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function NewTicketDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (t: Ticket) => void;
}): React.ReactElement {
  const projects = useProjects();
  const create = useCreateTicket();
  const projectList = projects.data ?? [];
  const [projectId, setProjectId] = useState(projectList[0]?.id ?? '');
  const [kind, setKind] = useState<TicketKind>('task');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<TicketPriority>('medium');

  const submit = (): void => {
    if (!projectId || !title.trim()) return;
    create.mutate(
      { projectId, kind, title: title.trim(), description: description.trim(), priority },
      { onSuccess: (t) => { onCreated(t); onClose(); } },
    );
  };

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center p-4" role="dialog" aria-label="New ticket" style={{ background: 'var(--overlay)' }}>
      <div className="v2-card w-full max-w-md p-4">
        <h2 className="mb-3 text-ui font-semibold text-text-1">New ticket</h2>
        <label className="mb-2 flex flex-col gap-1">
          <span className="text-micro text-text-3">Project</span>
          <select
            aria-label="Project"
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
            className="h-8 rounded-r4 border border-line-2 bg-bg-input px-2 text-ui text-text-1"
          >
            {projectList.map((p) => (
              <option key={p.id} value={p.id}>
                {projectLabel(p)}
              </option>
            ))}
          </select>
        </label>
        <label className="mb-2 flex flex-col gap-1">
          <span className="text-micro text-text-3">Title</span>
          <input
            aria-label="Title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="h-8 rounded-r4 border border-line-2 bg-bg-input px-2 text-ui text-text-1"
          />
        </label>
        <div className="mb-2 flex gap-2">
          <label className="flex flex-1 flex-col gap-1">
            <span className="text-micro text-text-3">Kind</span>
            <select
              aria-label="Kind"
              value={kind}
              onChange={(e) => setKind(e.target.value as TicketKind)}
              className="h-8 rounded-r4 border border-line-2 bg-bg-input px-2 text-ui text-text-1"
            >
              {TICKET_KINDS.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-1 flex-col gap-1">
            <span className="text-micro text-text-3">Priority</span>
            <select
              aria-label="Priority"
              value={priority}
              onChange={(e) => setPriority(e.target.value as TicketPriority)}
              className="h-8 rounded-r4 border border-line-2 bg-bg-input px-2 text-ui text-text-1"
            >
              {TICKET_PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="mb-4 flex flex-col gap-1">
          <span className="text-micro text-text-3">Description</span>
          <textarea
            aria-label="Description"
            rows={3}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="rounded-r4 border border-line-2 bg-bg-input px-2 py-1.5 text-ui text-text-1"
          />
        </label>
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" variant="primary" onClick={submit} disabled={create.isPending || !projectId || !title.trim()}>
            Create
          </Button>
        </div>
      </div>
    </div>
  );
}
