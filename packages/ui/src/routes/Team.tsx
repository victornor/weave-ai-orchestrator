import { useEffect, useState } from 'react';
import { agentUiStatus } from '@agent-conductor/shared';
import { Page, PageBody, PageHeader } from '../components/Page';
import { WorkerCard } from '../components/WorkerCard';
import { SkeletonRows } from '../components/Skeleton';
import { EmptyState, ErrorState, messageOf } from '../components/States';
import { StatusBadge, Badge } from '../components/StatusGlyph';
import { Button } from '../components/Button';
import { Markdown } from '../components/Markdown';
import { Sheet } from '../components/Sheet';
import { useConductor, useProjects, useRole, useRoleAction, useRoles, useRollbackCharter, useStartSession, useUpdateRole, useWorkerAction, useWorkers } from '../api/hooks';
import { useWs } from '../api/context';
import { useGo } from '../app/link';
import type * as T from '../api/types';
import { ago } from '../lib/format';

export function TeamRoute(): React.ReactElement {
  const ws = useWs();
  const go = useGo();
  const projects = useProjects();
  const roles = useRoles();
  const workers = useWorkers({});
  const conductor = useConductor();
  const workerAction = useWorkerAction();
  const startSession = useStartSession();
  const [openRole, setOpenRole] = useState<string | null>(null);
  const [startingFor, setStartingFor] = useState<string | null>(null);

  return (
    <Page>
      <PageHeader title="Team" meta={`${roles.data?.length ?? 0} roles · ${workers.data?.length ?? 0} workers`} />
      <PageBody className="p-4 md:p-5">
        <div className="mx-auto flex max-w-4xl flex-col gap-6">
          {/* conductor */}
          <section>
            <div className="ac-label mb-2">Conductor</div>
            {conductor.isLoading ? (
              <SkeletonRows rows={1} />
            ) : conductor.data ? (
              <div className="ac-card flex flex-wrap items-center gap-3 p-3.5">
                <StatusBadge status={agentUiStatus(conductor.data.agent.status)} />
                <span className="text-ui text-text-1">{conductor.data.agent.name}</span>
                <span className="ac-mono text-micro text-text-3">{conductor.data.agent.runtimeId}</span>
                <div className="flex-1" />
                <Button variant="ghost" size="sm" onClick={() => go('/w/$ws/chat', { params: { ws } })}>
                  Open thread
                </Button>
              </div>
            ) : null}
          </section>

          {/* projects → roles → workers */}
          {roles.isError ? (
            <ErrorState code="ROLES_QUERY_FAILED" message="Could not list roles." onRetry={() => void roles.refetch()} />
          ) : (projects.data ?? []).length === 0 ? (
            <EmptyState title="No projects yet." detail="Add one in Settings → Projects, or ask the conductor." />
          ) : (
            (projects.data ?? []).map((p) => {
              const projectRoles = (roles.data ?? []).filter((r) => r.projectId === p.id);
              return (
                <section key={p.id}>
                  <div className="ac-label mb-2">{p.slug}</div>
                  {projectRoles.length === 0 ? (
                    <p className="ac-card px-3.5 py-3 text-meta text-text-3">No role hired for this project yet.</p>
                  ) : (
                    <div className="flex flex-col gap-3">
                      {projectRoles.map((r) => {
                        const roleWorkers = (workers.data ?? []).filter((w) => w.roleId === r.id);
                        return (
                          <div key={r.id} className="ac-card p-3.5">
                            <div className="mb-2.5 flex flex-wrap items-center gap-2.5">
                              <span className="text-ui font-medium text-text-1">{r.name}</span>
                              <Badge>{r.status === 'pending_activation' ? 'awaiting hire approval' : r.status.replace(/_/g, ' ')}</Badge>
                              <div className="flex-1" />
                              <span className="ac-mono text-nano text-text-4">
                                {roleWorkers.length}/{r.maxWorkers} workers
                              </span>
                              <Button variant="ghost" size="sm" onClick={() => setOpenRole(r.id)}>
                                Charter
                              </Button>
                              <Button variant="ghost" size="sm" onClick={() => setStartingFor(startingFor === r.id ? null : r.id)}>
                                Start session
                              </Button>
                            </div>
                            <p className="mb-3 text-meta leading-relaxed text-text-2">{r.charterSummary}</p>
                            {startingFor === r.id ? (
                              <StartSessionForm
                                pending={startSession.isPending}
                                onCancel={() => setStartingFor(null)}
                                onStart={(title, description) => {
                                  startSession.mutate(
                                    { projectId: p.id, roleId: r.id, kind: 'task', title, description: description || undefined },
                                    { onSuccess: (agent) => { setStartingFor(null); go('/w/$ws/workers/$workerId', { params: { ws, workerId: agent.id } }); } },
                                  );
                                }}
                              />
                            ) : null}
                            {roleWorkers.length ? (
                              <div className="grid gap-2 sm:grid-cols-2">
                                {roleWorkers.map((w) => (
                                  <WorkerCard
                                    key={w.id}
                                    agent={w}
                                    projectSlug={p.slug}
                                    ticketIdentifier={w.ticketId}
                                    interactive={w.interactiveSession}
                                    onOpen={() => go('/w/$ws/workers/$workerId', { params: { ws, workerId: w.id } })}
                                    onResume={() => workerAction.mutate({ id: w.id, action: 'resume' })}
                                    resuming={workerAction.isPending}
                                  />
                                ))}
                              </div>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </section>
              );
            })
          )}
        </div>
      </PageBody>
      {openRole ? <RoleSheet roleId={openRole} onClose={() => setOpenRole(null)} /> : null}
    </Page>
  );
}

/**
 * Start an interactive session against this role (VS-101): a title (and optional description) is
 * all that's needed — the project and role are already this card's own, so there is nothing to pick.
 * Creates a fresh ticket marked as a session and starts its worker in the same call.
 */
function StartSessionForm({ pending, onCancel, onStart }: {
  pending: boolean;
  onCancel: () => void;
  onStart: (title: string, description: string) => void;
}): React.ReactElement {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  return (
    <form
      className="mb-3 flex flex-col gap-2 rounded-r4 border border-line-2 bg-bg-2 p-3"
      onSubmit={(e) => { e.preventDefault(); if (title.trim()) onStart(title.trim(), description.trim()); }}
    >
      <input
        autoFocus
        placeholder="What do you want to work on?"
        aria-label="Session title"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        className="h-8 rounded-r4 border border-line-2 bg-bg-input px-2.5 text-ui text-text-1"
      />
      <textarea
        placeholder="Anything else it should know (optional)"
        aria-label="Session description"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        rows={2}
        className="rounded-r4 border border-line-2 bg-bg-input px-2.5 py-1.5 text-meta text-text-1"
      />
      <div className="flex items-center gap-2">
        <Button type="submit" size="sm" variant="primary" disabled={pending || !title.trim()}>
          Start
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onCancel} disabled={pending}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

/**
 * The role's own worker cap, plus what it actually buys: the project cap applies too, so the
 * effective concurrency is the smaller of the two. Committed on blur or Enter, never per keystroke.
 */
function MaxWorkersField({ value, concurrency, pending, onCommit }: {
  value: number;
  concurrency: T.RoleConcurrency | undefined;
  pending: boolean;
  onCommit: (maxWorkers: number) => void;
}): React.ReactElement {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);

  const commit = (): void => {
    const n = Math.round(Number(draft));
    if (!Number.isFinite(n) || n < 1 || n > 32) { setDraft(String(value)); return; }
    setDraft(String(n));
    if (n !== value) onCommit(n);
  };

  const capped = concurrency !== undefined && concurrency.projectMax < concurrency.roleMax;
  return (
    <label className="flex items-center gap-2">
      <span className="ac-label">max workers</span>
      <input
        type="number"
        min={1}
        max={32}
        aria-label="max workers"
        disabled={pending}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
        className="ac-mono h-7 w-14 rounded-r4 border border-line-2 bg-bg-input px-2 text-micro text-text-1"
      />
      {concurrency ? (
        <span className="ac-mono text-nano text-text-4">
          {concurrency.effective} effective · {concurrency.live} live · {concurrency.free} free
          {capped ? ` · capped by the project limit of ${concurrency.projectMax}` : ''}
        </span>
      ) : null}
    </label>
  );
}

function RoleSheet({ roleId, onClose }: { roleId: string; onClose: () => void }): React.ReactElement {
  const role = useRole(roleId);
  const update = useUpdateRole();
  const action = useRoleAction();
  const rollback = useRollbackCharter();

  return (
    <Sheet open onClose={onClose} title={role.data?.role.name ?? 'Role'}>
      {role.isLoading ? (
        <SkeletonRows rows={4} />
      ) : role.data ? (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <MaxWorkersField
              value={role.data.role.maxWorkers}
              concurrency={role.data.concurrency}
              pending={update.isPending}
              onCommit={(maxWorkers) => update.mutate({ id: roleId, patch: { maxWorkers }, reason: 'changed from the web app' })}
            />
            <div className="flex-1" />
            {role.data.role.status === 'paused' ? (
              <Button size="sm" onClick={() => action.mutate({ id: roleId, action: 'resume', reason: 'resumed from the web app' })}>
                Resume
              </Button>
            ) : (
              <Button size="sm" onClick={() => action.mutate({ id: roleId, action: 'pause', reason: 'paused from the web app' })}>
                Pause
              </Button>
            )}
            <Button size="sm" variant="danger" onClick={() => action.mutate({ id: roleId, action: 'retire', reason: 'retired from the web app' })}>
              Retire
            </Button>
          </div>

          {update.isError ? (
            <ErrorState
              error={update.error}
              message={`The role was not changed: ${messageOf(update.error)}`}
              onRetry={() => update.reset()}
            />
          ) : null}

          <Markdown source={role.data.charter} />

          {role.data.revisions.length > 1 ? (
            <section>
              <div className="ac-label mb-2">Charter revisions</div>
              <div className="ac-card divide-y divide-line-1">
                {role.data.revisions.map((r) => (
                  <div key={r.revision} className="flex items-center gap-3 px-3 py-2">
                    <span className="ac-mono text-micro text-text-3">r{r.revision}</span>
                    <span className="ac-truncate flex-1 text-micro text-text-2">{r.reason ?? '—'}</span>
                    <span className="ac-mono text-nano text-text-4">{ago(r.createdAt)}</span>
                    <button type="button" className="text-micro text-accent-link" onClick={() => rollback.mutate({ id: roleId, revision: r.revision })}>
                      Roll back
                    </button>
                  </div>
                ))}
              </div>
            </section>
          ) : null}
        </div>
      ) : (
        <ErrorState code="ROLE_NOT_FOUND" message="This role is gone." />
      )}
    </Sheet>
  );
}
