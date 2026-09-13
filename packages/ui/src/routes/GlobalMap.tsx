/**
 * Daemon-wide Map (VS-176): workspaces, projects, roles, in-flight tickets and knowledge.
 */
import { lazy, Suspense, useMemo } from 'react';
import { Page, PageBody, PageHeader } from '../components/Page';
import { SkeletonRows } from '../components/Skeleton';
import { EmptyState, ErrorState } from '../components/States';
import {
  useWeaverMany,
  useKnowledgeIndexMany,
  useRolesMany,
  useTicketsMany,
  useWorkersMany,
  useWorkspaceProjects,
  useWorkspaces,
} from '../api/hooks';
import { useGo } from '../app/link';
import { isLiveWorker } from '../lib/board';
import { buildMapModel, type MapNode } from '../lib/map/model';

const MapCanvas = lazy(async () => ({ default: (await import('./MapCanvas')).MapCanvas }));

export function GlobalMapRoute(): React.ReactElement {
  const go = useGo();
  const workspaces = useWorkspaces();
  const listed = workspaces.data ?? [];
  const ids = useMemo(() => listed.map((w) => w.id), [listed]);
  const projectsByWs = useWorkspaceProjects(ids);
  const roleQueries = useRolesMany(ids);
  const ticketQueries = useTicketsMany(ids, { limit: 300 });
  const knowledgeQueries = useKnowledgeIndexMany(ids);
  const conductorQueries = useWeaverMany(ids);
  const workerQueries = useWorkersMany(ids);

  const liveWorkers = useMemo(
    () => workerQueries.flatMap((q) => (q.data ?? []).filter((w) => w.kind === 'worker' && w.ticketId && isLiveWorker(w))),
    [workerQueries],
  );

  const failed = listed.filter((_, i) => {
    const p = projectsByWs[listed[i]!.id];
    return p?.status === 'error' || roleQueries[i]?.isError || ticketQueries[i]?.isError || knowledgeQueries[i]?.isError;
  });

  const ready = listed.filter((w, i) => {
    const p = projectsByWs[w.id];
    return p?.status === 'success'
      && roleQueries[i]?.data !== undefined
      && ticketQueries[i]?.data !== undefined
      && knowledgeQueries[i]?.data !== undefined
      && !roleQueries[i]?.isError
      && !ticketQueries[i]?.isError
      && !knowledgeQueries[i]?.isError;
  });

  const model = useMemo(() => buildMapModel(ready.map((w) => {
    const i = listed.findIndex((x) => x.id === w.id);
    return {
      id: w.id,
      name: w.name,
      projects: projectsByWs[w.id]?.projects ?? [],
      roles: roleQueries[i]?.data ?? [],
      tickets: ticketQueries[i]?.data ?? [],
      knowledge: knowledgeQueries[i]?.data?.files ?? [],
      weaver: conductorQueries[i]?.data?.agent
        ? { id: conductorQueries[i]!.data!.agent.id, name: conductorQueries[i]!.data!.agent.name }
        : null,
    };
  })), [ready, listed, projectsByWs, roleQueries, ticketQueries, knowledgeQueries, conductorQueries]);

  const loaded = Boolean(workspaces.data) && listed.every((w, i) => {
    const p = projectsByWs[w.id];
    return p?.status === 'error' || p?.status === 'success'
      && (roleQueries[i]?.data !== undefined || roleQueries[i]?.isError)
      && (ticketQueries[i]?.data !== undefined || ticketQueries[i]?.isError)
      && (knowledgeQueries[i]?.data !== undefined || knowledgeQueries[i]?.isError);
  });

  const onOpen = (node: MapNode): void => {
    const ws = node.workspaceId;
    if (node.kind === 'ticket') {
      const id = node.href.split('/tickets/')[1];
      go('/w/$ws/tickets/$ticketId', { params: { ws, ticketId: id ? decodeURIComponent(id) : node.title } });
      return;
    }
    if (node.kind === 'project' && node.projectSlug) {
      go('/w/$ws/p/$project', { params: { ws, project: node.projectSlug } });
      return;
    }
    if (node.kind === 'knowledge') {
      go('/w/$ws/knowledge', { params: { ws }, search: node.search });
      return;
    }
    if (node.kind === 'role') {
      go('/w/$ws/roles', { params: { ws } });
      return;
    }
    if (node.kind === 'weaver') {
      go('/w/$ws/chat', { params: { ws } });
      return;
    }
    go('/w/$ws/needs', { params: { ws } });
  };

  if (workspaces.isError) {
    return (
      <Page>
        <PageHeader title="Map" />
        <PageBody className="p-4 md:p-5">
          <ErrorState code="WORKSPACES_QUERY_FAILED" message="Could not load workspaces." onRetry={() => void workspaces.refetch()} />
        </PageBody>
      </Page>
    );
  }

  return (
    <Page>
      <PageHeader title="Map" meta={loaded ? `${listed.length} workspace${listed.length === 1 ? '' : 's'}` : undefined} />
      <PageBody className="p-4 md:p-5">
        {!workspaces.data || !loaded ? (
          <SkeletonRows rows={8} />
        ) : listed.length === 0 ? (
          <EmptyState title="No workspaces yet." detail="The map fills in as workspaces are added." />
        ) : (
          <div className="flex flex-col gap-3">
            {failed.map((w) => {
              const i = listed.findIndex((x) => x.id === w.id);
              return (
                <ErrorState
                  key={w.id}
                  code="MAP_WORKSPACE_FAILED"
                  message={`Could not load ${w.name}.`}
                  onRetry={() => {
                    void roleQueries[i]?.refetch();
                    void ticketQueries[i]?.refetch();
                    void knowledgeQueries[i]?.refetch();
                  }}
                />
              );
            })}
            {model.nodes.length ? (
              <Suspense fallback={<SkeletonRows rows={8} />}>
                <MapCanvas model={model} onOpen={onOpen} liveWorkers={liveWorkers} />
              </Suspense>
            ) : failed.length === 0 ? (
              <EmptyState title="Nothing to draw yet." detail="Projects, roles and in-flight tickets show up here." />
            ) : null}
          </div>
        )}
      </PageBody>
    </Page>
  );
}
