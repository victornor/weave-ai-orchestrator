/**
 * V2's artifact rendering (VS-346): the shared inline panel for a ticket's Artifacts tab, and the
 * two full-screen readers — one for a ticket artifact (with its ticket context in the header) and
 * one for a workspace-scoped artifact (the address Knowledge links into).
 *
 * The document itself always renders through V1's `ArtifactViewer` — the same component, the same
 * raw-serve routes and the same sandbox — so there is exactly one rendering path.
 */
import { useState } from 'react';
import { useParams } from '@tanstack/react-router';
import { projectLabel } from '@weave-ai/shared';
import { ArtifactViewer, isPreviewableArtifactUrl } from '../../components/ArtifactViewer';
import { Badge } from '../../components/StatusGlyph';
import { SkeletonRows } from '../../components/Skeleton';
import { EmptyState } from '../../components/States';
import { A } from '../../app/link';
import { useTicket, useTicketDocumentRevisions, useTicketWorkProducts, useWorkspaceArtifacts, useWorkspaceArtifactRevisions } from '../../api/hooks';
import type { TicketDetail, WorkProduct } from '../../api/types';
import { projectColorVar } from '../../lib/projectColor';
import { ago } from '../../lib/format';
import { cx } from '../../lib/cx';

/** HANDOFF §14: the reader says the frame is sandboxed and has no network. */
export function SandboxNote(): React.ReactElement {
  return (
    <p className="flex items-center gap-2 text-micro text-text-2" data-v2-sandbox-note>
      <span className="inline-block size-2.5 flex-none rounded-pill border-[1.5px] border-text-2" aria-hidden />
      Artifacts render in a sandboxed frame and inherit the app's tokens. They cannot call the daemon.
    </p>
  );
}

export interface ArtifactTabState {
  previewable: WorkProduct[];
  linkOnly: WorkProduct[];
}

/**
 * Split a ticket's artifact work products into the ones with stored content (open in the viewer) and
 * link-only rows, using the ticket detail's `artifact:<key>` document list — the same rule V1 uses
 * (VS-331): a work product with no stored document must not mount an empty frame.
 */
export function splitArtifacts(detail: TicketDetail | undefined, products: readonly WorkProduct[] | undefined): ArtifactTabState {
  const artifacts = (products ?? []).filter((p) => p.type === 'artifact');
  const published = new Set(
    (detail?.documents ?? []).filter((d) => d.key.startsWith('artifact:')).map((d) => d.key.slice('artifact:'.length)),
  );
  const previewable = artifacts.filter((a) => a.externalId !== null && published.has(a.externalId));
  const linkOnly = artifacts.filter((a) => a.externalId === null || !published.has(a.externalId));
  return { previewable, linkOnly };
}

/** The inline panel on the ticket's Artifacts tab: the selected artifact above the fold. */
export function ArtifactInline({
  ws,
  ticketId,
  detail,
  products,
}: {
  ws: string;
  ticketId: string;
  detail: TicketDetail | undefined;
  products: readonly WorkProduct[] | undefined;
}): React.ReactElement {
  const { previewable, linkOnly } = splitArtifacts(detail, products);
  // A ticket can publish more than one artifact; the choice keys both the inline frame and the
  // full-screen link, so "Open full" opens exactly what is on screen.
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const selected = previewable.find((a) => a.externalId === selectedKey) ?? previewable[0] ?? null;
  const revisions = useTicketDocumentRevisions(ticketId, selected?.externalId ? `artifact:${selected.externalId}` : '');

  if (!selected && linkOnly.length === 0) {
    return <EmptyState title="No artifacts yet." detail="They appear here once an agent publishes one." />;
  }
  return (
    <div className="flex max-w-5xl flex-col gap-4">
      {previewable.length > 1 ? (
        <div className="flex flex-wrap items-center gap-2" role="tablist" aria-label="Artifacts">
          {previewable.map((a) => {
            const on = a.externalId === selected?.externalId;
            return (
              <button
                key={a.externalId}
                type="button"
                role="tab"
                aria-selected={on}
                data-v2-artifact-choice={a.externalId}
                onClick={() => setSelectedKey(a.externalId)}
                className={cx('v2-tag transition-colors duration-(--dur-fast) ease-ac', on ? 'text-accent-link' : 'text-text-3 hover:text-text-1')}
              >
                {a.title ?? a.externalId}
              </button>
            );
          })}
        </div>
      ) : null}

      {selected ? (
        <>
          <div className="flex items-center gap-2.5">
            <span className="min-w-0 flex-1">
              <span className="block truncate text-ui font-semibold text-text-1">{selected.title ?? selected.externalId}</span>
              <span className="ac-mono text-nano text-text-2">published {ago(selected.updatedAt)} · sandboxed</span>
            </span>
            <A
              to="/v2/w/$ws/tickets/$ticketId/artifacts/$key"
              params={{ ws, ticketId, key: selected.externalId ?? '' }}
              className="v2-tag text-text-2 hover:text-text-1"
            >
              Open full
            </A>
          </div>
          <ArtifactViewer
            ws={ws}
            ticketId={ticketId}
            artifact={{ key: selected.externalId ?? '', title: selected.title, url: selected.url ?? '' }}
            revisions={revisions.data}
          />
        </>
      ) : null}

      {linkOnly.length ? (
        <div className="v2-card divide-y divide-line-1">
          <div className="px-3.5 py-2 text-nano uppercase tracking-wide text-text-4">Not published</div>
          {linkOnly.map((a) => (
            <div key={a.id} className="flex items-center gap-3 px-3.5 py-2.5">
              <Badge>artifact</Badge>
              <span className="text-meta text-text-2">{a.title ?? a.externalId ?? 'artifact'}</span>
              {a.url ? (
                <a href={a.url} target="_blank" rel="noreferrer" className="ac-mono min-w-0 flex-1 truncate text-micro text-accent-link">
                  {a.url}
                </a>
              ) : (
                <span className="ac-mono flex-1 text-micro text-text-4">no URL</span>
              )}
            </div>
          ))}
        </div>
      ) : null}

      <SandboxNote />
    </div>
  );
}

/** The full-screen reader for a ticket artifact: `/v2/w/$ws/tickets/$ticketId/artifacts/$key`. */
export function V2TicketArtifactReader(): React.ReactElement {
  const { ws, ticketId, key } = useParams({ strict: false }) as { ws: string; ticketId: string; key: string };
  const detail = useTicket(ticketId);
  const ticket = detail.data?.ticket;
  const products = useTicketWorkProducts(ticket?.id ?? '');
  const product = (products.data ?? []).find((p) => p.type === 'artifact' && p.externalId === key) ?? null;
  const revisions = useTicketDocumentRevisions(ticket?.id ?? '', `artifact:${key}`);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex flex-none items-center gap-2.5 border-b border-line-1 bg-bg-1 px-4 py-2">
        <span className="min-w-0 flex-1">
          <span className="block truncate text-ui font-semibold text-text-1">{product?.title ?? key}</span>
          {ticket ? (
            <span className="ac-mono flex items-center gap-1.5 text-nano text-text-2">
              <span>{ticket.identifier}</span>
              {detail.data?.project ? (
                <span style={{ color: projectColorVar(detail.data.project.id, []) }} data-project-color>
                  {projectLabel(detail.data.project)}
                </span>
              ) : null}
              {detail.data?.worker ? <span>· {detail.data.worker.name}</span> : null}
            </span>
          ) : null}
        </span>
        <A to="/v2/w/$ws/tickets/$ticketId" params={{ ws, ticketId }} className="v2-tag text-text-2 hover:text-text-1">
          Ticket
        </A>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {detail.isLoading || products.isLoading ? (
          <SkeletonRows rows={3} />
        ) : !product ? (
          <EmptyState title="Artifact not found." detail="It may have been republished under a different key, or never existed on this ticket." />
        ) : !isPreviewableArtifactUrl(product.url ?? '', ws) ? (
          <ArtifactViewer ws={ws} ticketId={ticket?.id} artifact={{ key, title: product.title, url: product.url ?? '' }} revisions={revisions.data} />
        ) : (
          <div className="mx-auto flex max-w-5xl flex-col gap-4">
            <ArtifactViewer
              ws={ws}
              ticketId={ticket?.id}
              artifact={{ key, title: product.title, url: product.url ?? '' }}
              revisions={revisions.data}
            />
            <SandboxNote />
          </div>
        )}
      </div>
    </div>
  );
}

/** The workspace-scoped reader: `/v2/w/$ws/artifacts/$key` (Knowledge links in here). */
export function V2WorkspaceArtifactReader(): React.ReactElement {
  const { ws, key } = useParams({ strict: false }) as { ws: string; key: string };
  const artifacts = useWorkspaceArtifacts();
  const revisions = useWorkspaceArtifactRevisions(key);
  const summary = (artifacts.data ?? []).find((a) => a.key === key) ?? null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex flex-none items-center gap-2.5 border-b border-line-1 bg-bg-1 px-4 py-2">
        <span className="min-w-0 flex-1">
          <span className="block truncate text-ui font-semibold text-text-1">{summary?.title ?? key}</span>
          <span className="ac-mono text-nano text-text-2">{summary?.kind ?? 'artifact'} · workspace</span>
        </span>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {artifacts.isLoading ? (
          <SkeletonRows rows={3} />
        ) : !summary ? (
          <EmptyState title="Artifact not found." detail="It may have been republished under a different key, or never existed in this workspace." />
        ) : (
          <div className="mx-auto flex max-w-5xl flex-col gap-4">
            <ArtifactViewer
              ws={ws}
              artifact={{ key: summary.key, title: summary.title, url: `/api/w/${ws}/artifacts/${summary.key}/raw` }}
              revisions={revisions.data}
            />
            <SandboxNote />
          </div>
        )}
      </div>
    </div>
  );
}
