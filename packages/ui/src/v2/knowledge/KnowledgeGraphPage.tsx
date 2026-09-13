/**
 * The V2 knowledge graph route (VS-347): the kept V1 `KnowledgeGraphView` on the V2 canvas, with
 * V1's own document and hub viewers for the node a click opens. The graph keeps V1's model, filters,
 * drag/zoom/pan/search and node opening; only its tokens change, because it is rendered inside
 * `.v2-root` and `useThemeColours` now follows that root's `data-theme`.
 */
import { lazy, Suspense, useState } from 'react';
import { useProjects } from '../../api/hooks';
import { useSearchParams } from '../../app/link';
import { DocPanel, KnowledgeDocPanel, refFromPath, type DocRef } from '../../routes/KnowledgeDocs';

// The only route that needs the force-layout engine and the canvas renderer; loading it on demand
// keeps `react-force-graph-2d` and `d3-force` out of every other V2 page's chunk.
const KnowledgeGraphView = lazy(async () => ({ default: (await import('../../routes/KnowledgeGraph')).KnowledgeGraphView }));

interface HubOpen { scope: string; project?: string }

export function KnowledgeGraphPage(): React.ReactElement {
  const url = useSearchParams();
  const projects = useProjects();
  const [openDoc, setOpenDoc] = useState<DocRef | null>(null);
  const [openHub, setOpenHub] = useState<HubOpen | null>(null);

  const openPath = (path: string): void => {
    const ref = refFromPath(path, projects.data ?? []);
    if (ref) {
      setOpenHub(null);
      setOpenDoc(ref);
      return;
    }
    const m = /^projects\/([^/]+)\/PROJECT\.md$/.exec(path);
    const scope = m ? 'project' : path.endsWith('SHARED.md') ? 'shared' : path.endsWith('decisions.md') ? 'decisions' : 'workspace';
    const pid = m ? projects.data?.find((p) => p.slug === m[1])?.id : undefined;
    setOpenDoc(null);
    setOpenHub({ scope, ...(pid ? { project: pid } : {}) });
  };

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-4 p-4 md:p-5">
      <Suspense fallback={<div className="h-96 animate-pulse rounded-r6 bg-bg-2" aria-hidden />}>
        <KnowledgeGraphView project={url['project']} onOpen={openPath} />
      </Suspense>
      {openDoc ? <DocPanel doc={openDoc} projects={projects.data ?? []} onOpen={(ref) => { setOpenHub(null); setOpenDoc(ref); }} onClose={() => setOpenDoc(null)} /> : null}
      {openHub ? (
        <KnowledgeDocPanel
          scope={openHub.scope}
          project={openHub.project}
          onClose={() => setOpenHub(null)}
          onOpenDoc={(ref) => { setOpenHub(null); setOpenDoc(ref); }}
        />
      ) : null}
    </div>
  );
}
