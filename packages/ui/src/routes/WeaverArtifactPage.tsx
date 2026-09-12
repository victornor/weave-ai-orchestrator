/**
 * `/w/:ws/artifacts/:key` — the in-app page a weaver's `weave_artifact_put` URL points at (VS-297).
 * No ticket context at all: the artifact lives in the workspace's own store, not a ticket's. Reuses
 * `ArtifactViewer` unchanged (the same component the ticket page's Artifact tab renders through), so
 * there is exactly one rendering path for either shape of artifact.
 */
import { useParams } from '@tanstack/react-router';
import { Page, PageBody, PageHeader } from '../components/Page';
import { SkeletonRows } from '../components/Skeleton';
import { EmptyState } from '../components/States';
import { ArtifactViewer } from '../components/ArtifactViewer';
import { useWorkspaceArtifactRevisions, useWorkspaceArtifacts } from '../api/hooks';
import { useWs } from '../api/context';

export function WeaverArtifactRoute(): React.ReactElement {
  const ws = useWs();
  const { key } = useParams({ strict: false }) as { key: string };
  const artifacts = useWorkspaceArtifacts();
  const revisions = useWorkspaceArtifactRevisions(key);
  const summary = (artifacts.data ?? []).find((a) => a.key === key) ?? null;

  return (
    <Page>
      <PageHeader title={summary?.title ?? key} meta={summary?.kind ?? undefined} />
      <PageBody className="p-4 md:p-5">
        {artifacts.isLoading ? (
          <SkeletonRows rows={3} />
        ) : !summary ? (
          <EmptyState title="Artifact not found." detail="It may have been republished under a different key, or never existed in this workspace." />
        ) : (
          <div className="mx-auto max-w-5xl">
            <ArtifactViewer
              ws={ws}
              artifact={{ key: summary.key, title: summary.title, url: `/api/w/${ws}/artifacts/${summary.key}/raw` }}
              revisions={revisions.data}
            />
          </div>
        )}
      </PageBody>
    </Page>
  );
}
