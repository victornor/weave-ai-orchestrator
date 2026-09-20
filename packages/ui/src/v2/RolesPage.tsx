/**
 * The V2 Roles screen (web-v2/roles).
 *
 * The workspace's hired roles, grouped by project, with each role's state, worker count, charter and
 * running workers; a working worker's shared feed expanding in place (VS-345's `WorkerFeed`); the
 * Hire a role modal that formats the exact message the weaver receives and posts it to the weaver's
 * chat thread; and the kept role management (pause/resume/retire, charter edit with revisions and
 * rollback, max workers, Start session) through the existing roles hooks.
 *
 * The grouping, the hire-message builder and the weaver-thread pick are pure functions so the
 * screen's contract is testable without a browser.
 */
import { useEffect, useMemo, useState } from 'react';
import {
  agentUiStatus,
  projectLabel,
  type Agent,
  type AgentStatus,
  type Project,
  type Role,
  type Run,
} from '@weave-ai/shared';
import { A, useGo } from '../app/link';
import { useWs } from '../api/context';
import {
  useCreateThread,
  useModels,
  usePostThreadMessage,
  useProjects,
  usePutCharter,
  useRole,
  useRoleAction,
  useRoles,
  useRollbackCharter,
  useSessions,
  useStartSession,
  useThreads,
  useTickets,
  useUpdateRole,
  useWorkers,
  type WorkerListItem,
} from '../api/hooks';
import { EmptyState, ErrorState, messageOf } from '../components/States';
import { SkeletonRows } from '../components/Skeleton';
import { cents, initials, statusText, tokens } from '../lib/format';
import { projectColorVar } from '../lib/projectColor';
import { roleStateLabel } from '../lib/roleState';
import { defaultThread } from '../lib/threads';
import { cx } from '../lib/cx';
import { V2Page } from './V2Page';
import { WorkerFeed, useWorkerRun } from './WorkerFeed';
import { RoleChatControl, sessionForRole } from './roleChat';

/** The statuses a worker counts as an instance of a role right now (mirrors V1's Roles page). */
export const LIVE_WORKER_STATUSES = new Set(['provisioning', 'active', 'running', 'paused', 'error']);

export function liveWorkersOf<T extends { roleId: string | null; status: string }>(workers: readonly T[], roleId: string): T[] {
  return workers.filter((w) => w.roleId === roleId && LIVE_WORKER_STATUSES.has(w.status));
}

export interface RoleGroup {
  project: Project;
  roles: Role[];
}

/** Every project in order, each with the roles hired for it (including none). */
export function groupRolesByProject(projects: readonly Project[], roles: readonly Role[]): RoleGroup[] {
  return projects.map((project) => ({ project, roles: roles.filter((r) => r.projectId === project.id) }));
}

/** `pending_activation` is the state the human names "awaiting hire approval". */
export { roleStateLabel };

/**
 * The message the hire modal sends: the exact string the weaver's `weave-ai-hire` skill recognises
 * as a hire request for the named project. The preview and the sent body are this one function.
 */
export function buildHireRequest(slug: string, description: string): string {
  return `/hire-role project=${slug}\n\n${description.trim()}`;
}

/** A run's spend line: its tokens and, when known, its cost. */
export function spendLabel(run: Run | null): string {
  if (!run) return '';
  const usage = run.usage;
  const tok = usage ? `${tokens(usage.inputTokens + usage.outputTokens)} tok` : null;
  const cost = run.costCents != null ? cents(run.costCents) : null;
  return [tok, cost].filter(Boolean).join(' · ');
}

function workerStatusTone(status: string): string {
  const ui = agentUiStatus(status as AgentStatus);
  switch (ui) {
    case 'working':
      return 'text-working';
    case 'needs-you':
      return 'text-needs-you';
    case 'failed':
      return 'text-failed';
    case 'stalled':
      return 'text-stalled';
    case 'done':
      return 'text-done';
    default:
      return 'text-text-3';
  }
}

function Chip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }): React.ReactElement {
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

/** The screen as a V2 destination: the standard header over the Roles body. */
export function V2RolesPage(): React.ReactElement {
  return (
    <V2Page title="Roles">
      <V2RolesScreen />
    </V2Page>
  );
}

export function V2RolesScreen(): React.ReactElement {
  const ws = useWs();
  const projects = useProjects();
  const roles = useRoles();
  const workers = useWorkers({});
  const sessions = useSessions();
  const tickets = useTickets({ limit: 300 });

  const [projectFilter, setProjectFilter] = useState<string>('all');
  const [hasWorkers, setHasWorkers] = useState(false);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const [openRole, setOpenRole] = useState<string | null>(null);
  const [hireOpen, setHireOpen] = useState(false);

  const projectList = projects.data ?? [];
  const allWorkers = workers.data ?? [];
  const groups = useMemo(() => groupRolesByProject(projectList, roles.data ?? []), [projectList, roles.data]);
  const ticketsById = useMemo(() => new Map((tickets.data ?? []).map((t) => [t.id, t])), [tickets.data]);

  const filtered = useMemo(
    () =>
      groups
        .filter((g) => projectFilter === 'all' || g.project.id === projectFilter)
        .map((g) => ({ ...g, roles: g.roles.filter((r) => !hasWorkers || liveWorkersOf(allWorkers, r.id).length > 0) }))
        .filter((g) => !hasWorkers || g.roles.length > 0),
    [groups, projectFilter, hasWorkers, allWorkers],
  );

  const toggle = (workerId: string): void =>
    setExpanded((cur) => {
      const next = new Set(cur);
      if (next.has(workerId)) next.delete(workerId);
      else next.add(workerId);
      return next;
    });

  if (roles.isError) {
    return <ErrorState code="ROLES_QUERY_FAILED" message="Could not list roles." onRetry={() => void roles.refetch()} />;
  }
  if (roles.isLoading || projects.isLoading) {
    return (
      <div className="p-4">
        <SkeletonRows rows={4} />
      </div>
    );
  }

  const siblingIds = projectList.map((p) => p.id);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-1.5 border-b border-line-1 px-4 py-2">
        <Chip label="All projects" active={projectFilter === 'all'} onClick={() => setProjectFilter('all')} />
        {projectList.map((p) => (
          <Chip key={p.id} label={projectLabel(p)} active={projectFilter === p.id} onClick={() => setProjectFilter(p.id)} />
        ))}
        <span className="mx-1 h-4 w-px bg-line-2" aria-hidden />
        <Chip label="Has workers" active={hasWorkers} onClick={() => setHasWorkers((v) => !v)} />
        <button
          type="button"
          onClick={() => setHireOpen(true)}
          className="ml-auto h-7 flex-none rounded-r4 border border-line-2 bg-bg-2 px-2.5 text-micro text-text-1 hover:border-line-3"
        >
          Hire a role
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {projectList.length === 0 ? (
          <EmptyState title="No projects yet." detail="Add one in Settings, or ask the weaver." />
        ) : filtered.length === 0 ? (
          <EmptyState title="No roles match this filter." detail="Choose another project or clear Has workers." />
        ) : (
          <div className="mx-auto flex max-w-[960px] flex-col gap-6">
            {filtered.map((g) => (
              <RoleGroupSection
                key={g.project.id}
                group={g}
                colour={projectColorVar(g.project.id, siblingIds)}
                allWorkers={allWorkers}
                sessions={sessions.data ?? []}
                ticketsById={ticketsById}
                expanded={expanded}
                onToggle={toggle}
                onOpenCharter={setOpenRole}
                ws={ws}
              />
            ))}
          </div>
        )}
      </div>

      {openRole ? <RoleDrawer roleId={openRole} onClose={() => setOpenRole(null)} /> : null}
      {hireOpen ? <HireModal projects={projectList} onClose={() => setHireOpen(false)} /> : null}
    </div>
  );
}

function RoleGroupSection({
  group,
  colour,
  allWorkers,
  sessions,
  ticketsById,
  expanded,
  onToggle,
  onOpenCharter,
  ws,
}: {
  group: RoleGroup;
  colour: string;
  allWorkers: WorkerListItem[];
  sessions: readonly Agent[];
  ticketsById: Map<string, { id: string; identifier: string; title: string }>;
  expanded: ReadonlySet<string>;
  onToggle: (workerId: string) => void;
  onOpenCharter: (roleId: string) => void;
  ws: string;
}): React.ReactElement {
  const liveCount = group.roles.reduce((n, r) => n + liveWorkersOf(allWorkers, r.id).length, 0);

  return (
    <section>
      <div className="mb-2 flex items-baseline gap-2">
        <span className="ac-label" style={{ color: colour }}>
          {projectLabel(group.project)}
        </span>
        <span className="ac-mono text-nano text-text-3">
          {group.roles.length} {group.roles.length === 1 ? 'role' : 'roles'} · {liveCount} {liveCount === 1 ? 'worker' : 'workers'}
        </span>
      </div>
      {group.roles.length === 0 ? (
        <p className="v2-card px-3.5 py-3 text-meta text-text-3">No role hired for this project yet.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {group.roles.map((r) => (
            <RoleCard
              key={r.id}
              role={r}
              workers={liveWorkersOf(allWorkers, r.id)}
              session={sessionForRole(sessions, r.id)}
              ticketsById={ticketsById}
              expanded={expanded}
              onToggle={onToggle}
              onOpenCharter={onOpenCharter}
              ws={ws}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function RoleCard({
  role,
  workers,
  session,
  ticketsById,
  expanded,
  onToggle,
  onOpenCharter,
  ws,
}: {
  role: Role;
  workers: WorkerListItem[];
  session: Agent | null;
  ticketsById: Map<string, { id: string; identifier: string; title: string }>;
  expanded: ReadonlySet<string>;
  onToggle: (workerId: string) => void;
  onOpenCharter: (roleId: string) => void;
  ws: string;
}): React.ReactElement {
  const action = useRoleAction();
  const [menu, setMenu] = useState(false);
  const [starting, setStarting] = useState(false);
  // VS-526: the worker option a newly opened session starts on; changeable afterwards on its page.
  const sessionModels = useModels();
  const chatOptions = (sessionModels.data?.workerOptions ?? []).filter((o) => o.runtime);
  const [chatOption, setChatOption] = useState('');

  return (
    <div className="v2-card overflow-hidden" data-role-card={role.id}>
      <div className="flex flex-wrap items-center gap-2 px-3 py-2.5">
        <span className="text-ui font-medium text-text-1">{role.name}</span>
        <span className={cx('v2-tag', role.status === 'active' ? 'text-text-2' : 'text-text-4')}>{roleStateLabel(role.status)}</span>
        <div className="flex-1" />
        <span className="ac-mono flex-none text-nano text-text-3">
          {workers.length}/{role.maxWorkers}
        </span>
        <button type="button" onClick={() => onOpenCharter(role.id)} className="flex-none text-micro text-text-2 hover:text-text-1">
          Charter
        </button>
        {chatOptions.length > 0 ? (
          <select
            aria-label={`Worker option for ${role.name}'s session`}
            value={chatOption}
            onChange={(e) => setChatOption(e.target.value)}
            data-role-chat-option={role.id}
            className="ac-input ac-mono flex-none py-0.5 text-nano"
          >
            <option value="">workers setting</option>
            {chatOptions.map((o) => (<option key={o.id} value={o.id}>{o.id}</option>))}
          </select>
        ) : null}
        {/* VS-525: the shared role-chat control, the same one the project overview's Roles section
            renders, so both surfaces say "Start chat"/"Open chat" and withhold it for a role that
            cannot serve a session. */}
        <RoleChatControl role={role} session={session} ws={ws} workerModelId={chatOption || undefined} className="flex-none" />
        <button
          type="button"
          aria-expanded={starting}
          onClick={() => setStarting((v) => !v)}
          className="flex-none text-micro text-accent-link hover:text-text-1"
        >
          Start session
        </button>
        <div className="relative">
          <button
            type="button"
            aria-label={`Actions for ${role.name}`}
            aria-haspopup="menu"
            aria-expanded={menu}
            onClick={() => setMenu((v) => !v)}
            className="flex size-[22px] items-center justify-center rounded-[3px] text-text-3 hover:bg-bg-2 hover:text-text-1"
          >
            ⋯
          </button>
          {menu ? (
            <div role="menu" className="v2-anim-menu absolute right-0 top-6 z-10 flex w-32 flex-col rounded-r4 border border-line-2 bg-bg-1 py-1 shadow-float">
              {role.status === 'paused' ? (
                <button type="button" role="menuitem" className="px-3 py-1.5 text-left text-micro text-text-2 hover:bg-bg-2" onClick={() => { action.mutate({ id: role.id, action: 'resume', reason: 'resumed from the V2 Roles page' }); setMenu(false); }}>
                  Resume
                </button>
              ) : role.status === 'retired' ? null : (
                <button type="button" role="menuitem" className="px-3 py-1.5 text-left text-micro text-text-2 hover:bg-bg-2" onClick={() => { action.mutate({ id: role.id, action: 'pause', reason: 'paused from the V2 Roles page' }); setMenu(false); }}>
                  Pause
                </button>
              )}
              <button type="button" role="menuitem" className="px-3 py-1.5 text-left text-micro text-blocked hover:bg-bg-2" onClick={() => { action.mutate({ id: role.id, action: 'retire', reason: 'retired from the V2 Roles page' }); setMenu(false); }}>
                Retire
              </button>
            </div>
          ) : null}
        </div>
      </div>

      <p className="px-3 pb-2.5 text-meta leading-relaxed text-text-2">{role.charterSummary}</p>

      {action.isError ? (
        <p className="mx-3 mb-2 text-micro text-blocked" role="status">
          The role was not changed: {messageOf(action.error)}
        </p>
      ) : null}

      {starting ? <StartSessionForm pending={false} onCancel={() => setStarting(false)} roleId={role.id} projectId={role.projectId} ws={ws} /> : null}

      {workers.length ? (
        <div className="grid gap-1.5 px-3 pb-3 sm:grid-cols-2">
          {workers.map((w) => (
            <WorkerRow
              key={w.id}
              worker={w}
              ticket={w.ticketId ? ticketsById.get(w.ticketId) ?? null : null}
              expanded={expanded.has(w.id)}
              onToggle={onToggle}
              ws={ws}
            />
          ))}
        </div>
      ) : (
        <p className="px-3 pb-3 text-micro text-text-3">No workers running. Spawned per ticket when one is filed against this role.</p>
      )}
    </div>
  );
}

function WorkerRow({
  worker,
  ticket,
  expanded,
  onToggle,
  ws,
}: {
  worker: WorkerListItem;
  ticket: { id: string; identifier: string; title: string } | null;
  expanded: boolean;
  onToggle: (workerId: string) => void;
  ws: string;
}): React.ReactElement {
  const go = useGo();
  const { run, live } = useWorkerRun(worker.id, ws);
  const ticketLabel = ticket ? `${ticket.identifier} · ${ticket.title}` : null;
  // A worker with a ticket can be expanded whether or not it is running (VS-409): its newest run's
  // trace is worth opening in place. Only a worker with neither opens its page instead.
  const canExpand = live || ticket !== null;
  const open = expanded && canExpand;

  const onClick = (): void => {
    if (canExpand) onToggle(worker.id);
    else go('/w/$ws/workers/$workerId', { params: { ws, workerId: worker.id } });
  };

  return (
    <div
      className={cx('overflow-hidden rounded-r4 border bg-bg-2', open ? 'border-line-3' : 'border-line-1')}
      data-role-worker={worker.id}
      data-role-worker-live={live ? 'true' : 'false'}
    >
      <button type="button" aria-expanded={canExpand ? open : undefined} onClick={onClick} className="flex w-full items-center gap-2 px-2.5 py-2 text-left">
        <span className="ac-mono flex size-6 flex-none items-center justify-center rounded-r4 bg-bg-3 text-nano text-text-2" aria-hidden>
          {initials(worker.name)}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-meta font-medium text-text-1">{worker.name}</span>
          <span className="ac-mono block truncate text-nano text-text-3">{ticketLabel ?? statusText(worker.status)}</span>
        </span>
        <span className={cx('ac-mono flex-none text-nano', workerStatusTone(worker.status))}>{statusText(worker.status)}</span>
        {canExpand ? (
          <span
            className={cx(
              'block size-1.5 flex-none border-b-[1.5px] border-r-[1.5px] border-text-3 transition-transform',
              open ? 'rotate-[-135deg]' : 'rotate-45',
            )}
            aria-hidden
          />
        ) : null}
      </button>

      {open ? (
        <div className="v2-anim-fade border-t border-line-1">
          <div className="flex items-center gap-2 border-b border-line-1 bg-bg-1 px-2.5 py-1.5">
            <span className="ac-mono flex-none text-nano text-text-2">{run?.model ?? '—'}</span>
            <span className="ac-mono min-w-0 flex-1 truncate text-nano text-text-3">{ticketLabel ?? '—'}</span>
          </div>
          <WorkerFeed agentId={worker.id} ws={ws} compact resizable label={`Live feed for ${worker.name}`} onTicket={(id) => go('/w/$ws/tickets/$ticketId', { params: { ws, ticketId: id } })} />
          <div className="flex items-center gap-2 border-t border-line-1 px-2.5 py-1.5">
            <span className="ac-mono min-w-0 flex-1 truncate text-nano text-text-3">{spendLabel(run)}</span>
            <A to="/live" className="flex-none text-nano text-text-2 hover:text-text-1">
              Open in Live
            </A>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function StartSessionForm({
  roleId,
  projectId,
  ws,
  pending,
  onCancel,
}: {
  roleId: string;
  projectId: string;
  ws: string;
  pending: boolean;
  onCancel: () => void;
}): React.ReactElement {
  const go = useGo();
  const startSession = useStartSession();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');

  const openWorker = (agentId: string): void => {
    onCancel();
    go('/w/$ws/workers/$workerId', { params: { ws, workerId: agentId } });
  };

  return (
    <form
      className="v2-anim-rise mx-3 mb-3 flex flex-col gap-2 rounded-r4 border border-line-2 bg-bg-2 p-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!title.trim()) return;
        startSession.mutate(
          { projectId, roleId, kind: 'task', title: title.trim(), description: description.trim() || undefined },
          { onSuccess: (agent) => openWorker(agent.id) },
        );
      }}
    >
      <input
        autoFocus
        placeholder="What do you want to work on?"
        aria-label="Session title"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        className="h-8 rounded-r4 border border-line-2 bg-bg-input px-2.5 text-ui text-text-1 outline-none"
      />
      <textarea
        placeholder="Anything else it should know (optional)"
        aria-label="Session description"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        rows={2}
        className="rounded-r4 border border-line-2 bg-bg-input px-2.5 py-1.5 text-meta text-text-1 outline-none"
      />
      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={pending || startSession.isPending || !title.trim()}
          className="h-7 rounded-r4 border border-accent-edge bg-accent-tint px-3 text-micro text-text-1 disabled:opacity-40"
        >
          Start
        </button>
        <button type="button" onClick={onCancel} className="h-7 rounded-r4 border border-line-2 px-3 text-micro text-text-2">
          Cancel
        </button>
      </div>
      {startSession.isError ? (
        <p className="text-micro text-blocked" role="status">
          The session was not started: {messageOf(startSession.error)}
        </p>
      ) : null}
    </form>
  );
}

function RoleDrawer({ roleId, onClose }: { roleId: string; onClose: () => void }): React.ReactElement {
  const role = useRole(roleId);
  const update = useUpdateRole();
  const putCharter = usePutCharter();
  const rollback = useRollbackCharter();

  const [charter, setCharter] = useState('');
  const [reason, setReason] = useState('');
  const [maxWorkers, setMaxWorkers] = useState('');
  const [synced, setSynced] = useState(false);

  useEffect(() => {
    if (role.data && !synced) {
      setCharter(role.data.charter);
      setMaxWorkers(String(role.data.role.maxWorkers));
      setSynced(true);
    }
  }, [role.data, synced]);

  const detail = role.data;
  const charterDirty = detail ? charter.trim() !== detail.charter.trim() : false;
  const canSaveCharter = Boolean(detail) && charterDirty && reason.trim().length > 0 && !putCharter.isPending;
  const error = update.isError ? update.error : putCharter.isError ? putCharter.error : rollback.isError ? rollback.error : null;

  return (
    <div className="v2-anim-fade fixed inset-0 z-40 flex justify-end" role="dialog" aria-modal="true" aria-label={detail?.role.name ?? 'Role'}>
      <button type="button" className="absolute inset-0" style={{ background: 'var(--overlay)' }} aria-label="Close" onClick={onClose} />
      <div className="v2-anim-drawer relative flex h-full w-full max-w-[440px] flex-col border-l border-line-2 bg-bg-1" style={{ boxShadow: 'var(--elev-sheet)' }}>
        <header className="flex h-[38px] flex-none items-center gap-2 border-b border-line-1 px-3">
          <span className="min-w-0 flex-1 truncate text-ui font-medium text-text-1">{detail?.role.name ?? 'Role'}</span>
          {detail ? <span className="v2-tag text-text-3">{roleStateLabel(detail.role.status)}</span> : null}
          <button type="button" onClick={onClose} aria-label="Close" className="flex size-[22px] items-center justify-center rounded-[3px] text-text-3 hover:bg-bg-2 hover:text-text-1">
            ×
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {role.isLoading ? (
            <SkeletonRows rows={4} />
          ) : !detail ? (
            <ErrorState code="ROLE_NOT_FOUND" message="This role is gone." />
          ) : (
            <div className="flex flex-col gap-5">
              {error ? (
                <ErrorState error={error} message={messageOf(error)} onRetry={() => { update.reset(); putCharter.reset(); rollback.reset(); }} />
              ) : null}

              <section>
                <div className="ac-label mb-1.5">Charter</div>
                <textarea
                  value={charter}
                  onChange={(e) => setCharter(e.target.value)}
                  rows={10}
                  aria-label="Charter"
                  className="w-full rounded-r4 border border-line-2 bg-bg-input p-2.5 text-meta leading-relaxed text-text-1 outline-none"
                />
                <input
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Reason for the change (recorded)"
                  aria-label="Reason for the charter change"
                  className="mt-2 h-8 w-full rounded-r4 border border-line-2 bg-bg-input px-2.5 text-meta text-text-1 outline-none"
                />
                <div className="mt-2 flex items-center gap-2">
                  <button
                    type="button"
                    disabled={!canSaveCharter}
                    onClick={() => detail && putCharter.mutate({ id: roleId, charter, reason: reason.trim() })}
                    className="h-7 rounded-r4 border border-accent-edge bg-accent-tint px-3 text-micro text-text-1 disabled:opacity-40"
                  >
                    Save charter
                  </button>
                  <span className="text-nano text-text-3">
                    {detail.role.specRevision ? `r${detail.role.specRevision}` : ''} · {detail.revisions.length} revision{detail.revisions.length === 1 ? '' : 's'}
                  </span>
                </div>
              </section>

              {detail.revisions.length > 0 ? (
                <section>
                  <div className="ac-label mb-1.5">Revisions</div>
                  <div className="v2-card divide-y divide-line-1">
                    {detail.revisions.map((r) => (
                      <div key={r.revision} className="flex items-center gap-2 px-2.5 py-2">
                        <span className="ac-mono text-nano text-text-3">r{r.revision}</span>
                        <span className="min-w-0 flex-1 truncate text-micro text-text-2">{r.reason ?? '—'}</span>
                        <button type="button" onClick={() => rollback.mutate({ id: roleId, revision: r.revision })} className="flex-none text-micro text-accent-link hover:text-text-1">
                          Roll back
                        </button>
                      </div>
                    ))}
                  </div>
                </section>
              ) : null}

              <section>
                <div className="ac-label mb-1.5">Max workers</div>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min={1}
                    max={32}
                    value={maxWorkers}
                    onChange={(e) => setMaxWorkers(e.target.value)}
                    aria-label="Max workers"
                    className="ac-mono h-8 w-20 rounded-r4 border border-line-2 bg-bg-input px-2.5 text-meta text-text-1 outline-none"
                  />
                  <button
                    type="button"
                    disabled={!detail || maxWorkers === '' || Number(maxWorkers) === detail.role.maxWorkers || update.isPending}
                    onClick={() => update.mutate({ id: roleId, patch: { maxWorkers: Number(maxWorkers) }, reason: 'max workers set from the V2 Roles page' })}
                    className="h-7 rounded-r4 border border-line-2 bg-bg-2 px-3 text-micro text-text-1 disabled:opacity-40"
                  >
                    Save
                  </button>
                </div>
              </section>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function HireModal({ projects, onClose }: { projects: Project[]; onClose: () => void }): React.ReactElement {
  const threads = useThreads();
  const createThread = useCreateThread();
  const post = usePostThreadMessage();

  const [slug, setSlug] = useState<string | null>(projects[0]?.slug ?? null);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);

  const preview = slug ? buildHireRequest(slug, text) : '';
  const busy = post.isPending || createThread.isPending;
  const canSend = Boolean(slug) && text.trim().length > 0 && !busy;
  const siblingIds = projects.map((p) => p.id);

  const send = (): void => {
    if (!slug) return;
    setError(null);
    const body = buildHireRequest(slug, text);
    // Close only once the post has succeeded: a failure must leave the modal open with the message,
    // never close on a request the human would believe was sent.
    const postTo = (threadId: string): void =>
      post.mutate(
        { threadId, body },
        { onSuccess: () => onClose(), onError: (e) => setError(`The request was not sent: ${messageOf(e)}`) },
      );
    // The same thread the chat opens (VS-351 steer): no explicit thread, no `is_primary` on the
    // summary — the default thread, creating one only when the workspace has none.
    const thread = defaultThread(threads.data ?? []);
    if (thread) {
      postTo(thread.id);
      return;
    }
    createThread
      .mutateAsync({})
      .then((t) => postTo(t.id))
      .catch((e) => setError(`The request was not sent: ${messageOf(e)}`));
  };

  return (
    <div className="v2-anim-fade fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="Hire a role">
      <button type="button" className="absolute inset-0" style={{ background: 'var(--overlay)' }} aria-label="Close" onClick={onClose} />
      <div className="v2-anim-pop relative flex max-h-full w-full max-w-[520px] flex-col overflow-hidden rounded-r6 border border-line-2 bg-bg-1" style={{ boxShadow: 'var(--elev-sheet)' }}>
        <header className="flex flex-none items-center gap-2 border-b border-line-1 px-3.5 py-2.5">
          <span className="text-ui font-medium text-text-1">Hire a role</span>
          <span className="ac-mono ml-auto flex-none text-nano text-text-3">sent to the weaver</span>
          <button type="button" onClick={onClose} aria-label="Close" className="flex size-[22px] flex-none items-center justify-center rounded-[3px] text-text-3 hover:bg-bg-2 hover:text-text-1">
            ×
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto p-3.5">
          <div className="ac-label mb-1.5">Project</div>
          <div className="mb-4 flex flex-wrap gap-1.5">
            {projects.map((p) => {
              const active = slug === p.slug;
              const colour = projectColorVar(p.id, siblingIds);
              return (
                <button
                  key={p.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setSlug(p.slug)}
                  className="v2-tag px-2.5 py-1 text-micro"
                  style={{ color: colour, background: active ? `color-mix(in oklab, ${colour} 14%, transparent)` : 'transparent' }}
                >
                  {projectLabel(p)}
                </button>
              );
            })}
          </div>

          <label className="ac-label mb-1.5 block" htmlFor="hire-description">
            What should this role own?
          </label>
          <textarea
            id="hire-description"
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={4}
            placeholder="Plain words are enough."
            className="mb-1.5 w-full rounded-r4 border border-accent-edge bg-bg-input p-2.5 text-meta leading-relaxed text-text-1 outline-none"
            style={{ boxShadow: '0 0 0 3px var(--focus-ring)' }}
          />
          <p className="mb-4 text-micro text-text-3">Plain words are enough. The weaver writes the charter, picks the model tier and names the role.</p>

          <div className="ac-label mb-1.5">The weaver receives</div>
          <div className="rounded-r4 border border-line-1 bg-bg-2 p-2.5">
            <pre className="ac-mono whitespace-pre-wrap text-micro leading-relaxed text-text-2">{preview || 'Choose a project and describe the role.'}</pre>
          </div>
          {error ? <p className="mt-2 text-micro text-blocked" role="status">{error}</p> : null}
        </div>

        <footer className="flex flex-none items-center gap-2 border-t border-line-1 px-3.5 py-2.5">
          <span className="min-w-0 flex-1 text-micro text-text-3">You will be asked to approve the charter before any worker runs.</span>
          <button type="button" onClick={onClose} className="h-[30px] flex-none rounded-r4 border border-line-2 px-3 text-micro text-text-2">
            Cancel
          </button>
          <button
            type="button"
            disabled={!canSend}
            aria-busy={busy}
            onClick={send}
            className="h-[30px] flex-none rounded-r4 border border-accent-edge bg-accent-tint px-3.5 text-micro text-text-1 disabled:opacity-40"
          >
            Send to weaver
          </button>
        </footer>
      </div>
    </div>
  );
}
