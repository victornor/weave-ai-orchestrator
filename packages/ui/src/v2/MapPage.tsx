/**
 * V2's Map screen (web-v2/map, VS-350, HANDOFF §13).
 *
 * A workspace → project → worker graph with `runs in` edges, fanned out across the workspaces and
 * laid out by V1's pure radial primitives. The filter row is `Everywhere · each workspace ·
 * Attention`; the legend derives from the statuses actually present; a node routes by kind (a worker
 * opens Live, a project opens Work, a workspace opens Chat); the footer states what is shown in
 * words distinct from the header's roster.
 */
import { useMemo, useState } from 'react';
import { agentUiStatus } from '@weave-ai/shared';
import { useWorkersMany, useWorkspaceProjects, useWorkspaces } from '../api/hooks';
import { useGo } from '../app/link';
import type { MapNode } from '../lib/map/model';
import { STATUS_LABEL, STATUS_VAR } from '../lib/status';
import { cx } from '../lib/cx';
import { SkeletonRows } from '../components/Skeleton';
import { EmptyState, ErrorState } from '../components/States';
import { V2Page } from './V2Page';
import { MapGraph } from './map/MapCanvas';
import { buildWorkerMapModel, pruneWorkerGraph, workerStatusesPresent } from './map/model';

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

export function V2MapPage(): React.ReactElement {
  return (
    <V2Page title="Map">
      <MapBody />
    </V2Page>
  );
}

export function MapBody(): React.ReactElement {
  const go = useGo();
  const workspaces = useWorkspaces();
  const listed = workspaces.data ?? [];
  const ids = useMemo(() => listed.map((w) => w.id), [listed]);
  const nameById = useMemo(() => new Map(listed.map((w) => [w.id, w.name])), [listed]);

  const workersQueries = useWorkersMany(ids);
  const projectsByWs = useWorkspaceProjects(ids);
  const [scope, setScope] = useState<string>('all');

  const inputs = useMemo(
    () =>
      ids.map((id, i) => ({
        id,
        name: nameById.get(id) ?? id,
        projects: projectsByWs[id]?.projects ?? [],
        workers: (workersQueries[i]?.data ?? []).filter((w) => w.kind === 'worker'),
      })),
    [ids, nameById, projectsByWs, workersQueries],
  );

  const full = useMemo(() => buildWorkerMapModel(inputs), [inputs]);
  const model = useMemo(() => pruneWorkerGraph(full, scope), [full, scope]);

  const legend = useMemo(() => workerStatusesPresent(model).map((s) => ({ status: agentUiStatus(s), label: STATUS_LABEL[agentUiStatus(s)], color: STATUS_VAR[agentUiStatus(s)] })), [model]);
  const workerCount = model.nodes.filter((n) => n.kind === 'worker').length;

  const loaded = Boolean(workspaces.data) && workersQueries.every((q) => q.data !== undefined || q.isError);
  const errored = workersQueries.length > 0 && workersQueries.every((q) => q.isError);

  const onOpen = (node: MapNode): void => {
    if (node.kind === 'worker') {
      go('/v2/live', { search: { worker: node.search?.worker } });
      return;
    }
    if (node.kind === 'project') {
      // Work filters tickets by project id (`filterTickets`), so carry the id, not the slug.
      go('/v2/w/$ws/work', { params: { ws: node.workspaceId }, search: { project: node.projectId } });
      return;
    }
    go('/v2/w/$ws/chat', { params: { ws: node.workspaceId } });
  };

  if (workspaces.isError) {
    return <ErrorState code="WORKSPACES_QUERY_FAILED" message="Could not load workspaces." onRetry={() => void workspaces.refetch()} />;
  }
  if (!workspaces.data || !loaded) {
    return (
      <div className="p-4">
        <SkeletonRows rows={6} />
      </div>
    );
  }
  if (errored) {
    return <ErrorState code="MAP_QUERY_FAILED" message="Could not load the graph." onRetry={() => void workersQueries[0]?.refetch()} />;
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-1.5 border-b border-line-1 px-4 py-2" data-v2-map-filters>
        <Chip label="Everywhere" active={scope === 'all'} onClick={() => setScope('all')} />
        {listed.map((w) => (
          <Chip key={w.id} label={w.name} active={scope === w.id} onClick={() => setScope(w.id)} />
        ))}
        <Chip label="Attention" active={scope === 'attention'} onClick={() => setScope('attention')} />
        <div className="ml-auto flex flex-wrap items-center gap-3" data-v2-map-legend>
          {legend.map((l) => (
            <span key={l.status} className="flex items-center gap-1.5">
              <span className="size-2 flex-none rounded-pill" style={{ background: l.color }} aria-hidden />
              <span className="text-nano text-text-3">{l.label}</span>
            </span>
          ))}
        </div>
      </div>

      {model.nodes.length === 0 ? (
        <div className="p-6">
          <EmptyState title="Nothing to show here." detail={scope === 'attention' ? 'No worker needs attention.' : 'Add a project or hire a worker to see it here.'} />
        </div>
      ) : (
        <MapGraph model={model} onOpen={onOpen} />
      )}

      <div className="flex flex-wrap items-center gap-2 border-t border-line-1 px-4 py-2" data-v2-map-footer>
        <span className="text-micro text-text-3">Click a node to open it · edges are “runs in”</span>
        <span className="ml-auto ac-mono text-nano text-text-3">
          {model.nodes.length} nodes · {workerCount} workers shown
        </span>
      </div>
    </div>
  );
}
