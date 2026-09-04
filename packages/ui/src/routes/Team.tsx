import { useState } from 'react';
import { agentUiStatus } from '@openconductor/shared';
import { Page, PageBody, PageHeader } from '../components/Page';
import { WorkerCard } from '../components/WorkerCard';
import { SkeletonRows } from '../components/Skeleton';
import { EmptyState, ErrorState } from '../components/States';
import { StatusBadge, Badge } from '../components/StatusGlyph';
import { Button } from '../components/Button';
import { Markdown } from '../components/Markdown';
import { Sheet } from '../components/Sheet';
import { useConductor, useProjects, useRole, useRoleAction, useRoles, useRollbackCharter, useRuntimeModels, useRuntimes, useUpdateRole, useWorkers } from '../api/hooks';
import { useWs } from '../api/context';
import { useGo } from '../app/link';
import { ago } from '../lib/format';

export function TeamRoute(): React.ReactElement {
  const ws = useWs();
  const go = useGo();
  const projects = useProjects();
  const roles = useRoles();
  const workers = useWorkers({});
  const conductor = useConductor();
  const [openRole, setOpenRole] = useState<string | null>(null);

  return (
    <Page>
      <PageHeader title="Team" meta={`${roles.data?.length ?? 0} roles · ${workers.data?.length ?? 0} workers`} />
      <PageBody className="p-4 md:p-5">
        <div className="mx-auto flex max-w-4xl flex-col gap-6">
          {/* conductor */}
          <section>
            <div className="oc-label mb-2">Conductor</div>
            {conductor.isLoading ? (
              <SkeletonRows rows={1} />
            ) : conductor.data ? (
              <div className="oc-card flex flex-wrap items-center gap-3 p-3.5">
                <StatusBadge status={agentUiStatus(conductor.data.agent.status)} />
                <span className="text-ui text-text-1">{conductor.data.agent.name}</span>
                <span className="oc-mono text-micro text-text-3">
                  {conductor.data.agent.runtimeId}
                  {conductor.data.agent.model ? ` · ${conductor.data.agent.model}` : ''}
                </span>
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
                  <div className="oc-label mb-2">{p.slug}</div>
                  {projectRoles.length === 0 ? (
                    <p className="oc-card px-3.5 py-3 text-meta text-text-3">No role hired for this project yet.</p>
                  ) : (
                    <div className="flex flex-col gap-3">
                      {projectRoles.map((r) => {
                        const roleWorkers = (workers.data ?? []).filter((w) => w.roleId === r.id);
                        return (
                          <div key={r.id} className="oc-card p-3.5">
                            <div className="mb-2.5 flex flex-wrap items-center gap-2.5">
                              <span className="text-ui font-medium text-text-1">{r.name}</span>
                              <Badge>{r.status}</Badge>
                              <span className="oc-mono text-micro text-text-3">
                                {r.runtimeId}
                                {r.model ? ` · ${r.model}` : ''}
                              </span>
                              <div className="flex-1" />
                              <span className="oc-mono text-nano text-text-4">
                                {roleWorkers.length}/{r.maxWorkers} workers
                              </span>
                              <Button variant="ghost" size="sm" onClick={() => setOpenRole(r.id)}>
                                Charter
                              </Button>
                            </div>
                            <p className="mb-3 text-meta leading-relaxed text-text-2">{r.charterSummary}</p>
                            {roleWorkers.length ? (
                              <div className="grid gap-2 sm:grid-cols-2">
                                {roleWorkers.map((w) => (
                                  <WorkerCard
                                    key={w.id}
                                    agent={w}
                                    projectSlug={p.slug}
                                    ticketIdentifier={w.ticketId}
                                    onOpen={() => go('/w/$ws/workers/$workerId', { params: { ws, workerId: w.id } })}
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

function RoleSheet({ roleId, onClose }: { roleId: string; onClose: () => void }): React.ReactElement {
  const role = useRole(roleId);
  const runtimes = useRuntimes();
  const models = useRuntimeModels(role.data?.role.runtimeId);
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
            <label className="flex items-center gap-2">
              <span className="oc-label">runtime</span>
              <select
                value={role.data.role.runtimeId}
                onChange={(e) => update.mutate({ id: roleId, patch: { runtimeId: e.target.value }, reason: 'changed from the web app' })}
                className="oc-mono h-7 rounded-r4 border border-line-2 bg-bg-input px-2 text-micro text-text-1"
              >
                {(runtimes.data ?? []).map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.displayName}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-2">
              <span className="oc-label">model</span>
              <select
                value={role.data.role.model ?? ''}
                onChange={(e) => update.mutate({ id: roleId, patch: { model: e.target.value }, reason: 'changed from the web app' })}
                className="oc-mono h-7 rounded-r4 border border-line-2 bg-bg-input px-2 text-micro text-text-1"
              >
                <option value="">default</option>
                {(models.data ?? []).map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </label>
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

          <Markdown source={role.data.charter} />

          {role.data.revisions.length > 1 ? (
            <section>
              <div className="oc-label mb-2">Charter revisions</div>
              <div className="oc-card divide-y divide-line-1">
                {role.data.revisions.map((r) => (
                  <div key={r.revision} className="flex items-center gap-3 px-3 py-2">
                    <span className="oc-mono text-micro text-text-3">r{r.revision}</span>
                    <span className="oc-truncate flex-1 text-micro text-text-2">{r.reason ?? '—'}</span>
                    <span className="oc-mono text-nano text-text-4">{ago(r.createdAt)}</span>
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
