/**
 * The project's knowledge (VS-95): the sections of its hub file with how much of the budget they
 * use, and its linked documents. Reading and editing stay in the Knowledge area, which this opens.
 */
import { useMemo } from 'react';
import { A } from '../../app/link';
import { useKnowledgeDoc, useKnowledgeDocs, useKnowledgeHealth } from '../../api/hooks';
import { BudgetMeter } from '../../components/BudgetMeter';
import { SkeletonRows } from '../../components/Skeleton';
import { projectLabel } from '@weave-ai/shared';
import { ago } from '../../lib/format';
import { knowledgeSections } from '../../lib/projectOverview';
import type { ProjectSectionProps } from './sections';

export function KnowledgeSection({ project, ws }: ProjectSectionProps): React.ReactElement {
  const hub = useKnowledgeDoc('project', project.id);
  const docs = useKnowledgeDocs(project.id);
  const health = useKnowledgeHealth(project.id);
  const sections = useMemo(() => knowledgeSections(hub.data?.body), [hub.data]);
  const linked = (docs.data ?? []).filter((d) => d.scope === 'project');

  if (hub.isLoading) return <SkeletonRows rows={3} />;

  return (
    <div className="flex flex-col gap-3.5">
      {hub.data ? (
        <BudgetMeter
          label={`${projectLabel(project)} · project KB`}
          used={hub.data.tokenEstimate}
          budget={hub.data.budgetTokens}
          lastCuratedAt={hub.data.lastCuratedAt}
          curationPending={hub.data.curationPending}
        />
      ) : null}

      {sections.length === 0 ? (
        <p className="text-meta text-text-3">This project has no knowledge file yet.</p>
      ) : (
        <ul className="flex flex-wrap gap-1.5">
          {sections.map((s) => (
            <li
              key={s.name}
              className="ac-mono rounded-pill border border-line-2 px-2 py-0.5 text-nano text-text-3"
              title={s.body ? undefined : 'nothing written yet'}
            >
              {s.name}
              {s.body ? '' : ' ·'}
            </li>
          ))}
        </ul>
      )}

      <div>
        <div className="ac-label mb-1.5">Documents</div>
        {docs.isLoading ? (
          <SkeletonRows rows={2} />
        ) : linked.length === 0 ? (
          <p className="text-meta text-text-3">No linked documents in this project.</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {linked.map((d) => (
              <li key={d.path} className="flex items-center gap-2 px-1">
                <span className="ac-mono flex-none text-nano text-text-3">{d.slug}</span>
                <span className="min-w-0 flex-1 truncate text-meta text-text-2">{d.title}</span>
                <span className="ac-mono flex-none text-nano text-text-4">{ago(d.updatedAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <KnowledgeHealthBlock ws={ws} projectId={project.id} health={health.data} loading={health.isLoading} />

      <A
        to="/w/$ws/knowledge"
        params={{ ws }}
        search={{ project: project.id, tab: 'knowledge' }}
        className="text-micro font-medium text-accent-link"
      >
        Open this project's knowledge
      </A>
    </div>
  );
}

/** The network's health for this project (VS-102): reachability and freshness, never entry count. */
function KnowledgeHealthBlock({
  ws,
  projectId,
  health,
  loading,
}: {
  ws: string;
  projectId: string;
  health: ReturnType<typeof useKnowledgeHealth>['data'];
  loading: boolean;
}): React.ReactElement {
  if (loading) return <SkeletonRows rows={1} />;
  const orphans = health?.orphans.length ?? 0;
  const stale = health?.stale.length ?? 0;
  const unresolved = health?.unresolvedLinks.length ?? 0;
  const clean = orphans === 0 && stale === 0 && unresolved === 0;

  return (
    <div>
      <div className="ac-label mb-1.5">Knowledge health</div>
      {clean ? (
        <p className="text-meta text-text-3">No orphan documents, no stale documents, no unresolved links.</p>
      ) : (
        <A
          to="/w/$ws/knowledge"
          params={{ ws }}
          search={{ project: projectId, tab: 'knowledge' }}
          className="flex flex-wrap gap-1.5"
        >
          {orphans > 0 ? <HealthBadge count={orphans} label={orphans === 1 ? 'document with no backlink' : 'documents with no backlink'} /> : null}
          {stale > 0 ? <HealthBadge count={stale} label={stale === 1 ? 'document not updated in 90 days' : 'documents not updated in 90 days'} /> : null}
          {unresolved > 0 ? <HealthBadge count={unresolved} label={unresolved === 1 ? 'unresolved link' : 'unresolved links'} /> : null}
        </A>
      )}
    </div>
  );
}

function HealthBadge({ count, label }: { count: number; label: string }): React.ReactElement {
  return (
    <span className="ac-mono rounded-pill border border-line-2 px-2 py-0.5 text-nano text-text-3">
      {count} {label}
    </span>
  );
}
