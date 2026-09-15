/**
 * The V2 knowledge explorer route (VS-347): the kept V1 `KnowledgeExplorer`, which already composes
 * the shared document, hub, archive and artifact viewers and takes all its data from the same
 * `api/hooks`. Rendered inside the V2 root, its token utilities resolve against the Mono tokens, so
 * it is restyled by the theme rather than forked.
 */
import { lazy, Suspense } from 'react';
import { useSearchParams } from '../../app/link';

const KnowledgeExplorer = lazy(async () => ({ default: (await import('./KnowledgeExplorerView')).KnowledgeExplorer }));

export function KnowledgeExplorerPage(): React.ReactElement {
  const url = useSearchParams();
  return (
    <div className="h-full min-h-0 p-4 md:p-5">
      <Suspense fallback={<div className="h-full animate-pulse rounded-r6 bg-bg-2" aria-hidden />}>
        <div className="h-full min-h-0">
          <KnowledgeExplorer project={url['project']} />
        </div>
      </Suspense>
    </div>
  );
}
