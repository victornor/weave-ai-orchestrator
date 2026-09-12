/**
 * Renders one published artifact (VS-269) through its sandboxed raw-serve route: an iframe, a
 * revision selector, and open/copy/download actions. Extracted from `TicketPage.tsx`'s `ArtifactsTab`
 * (VS-270) so the document explorer's Artifacts entry reuses this exact rendering path — same route,
 * same CSP, same component — rather than a second one. Takes its artifact and revisions as props; it
 * has no opinion on where its caller's list of artifacts or selection came from.
 */
import { useState } from 'react';
import type { DocumentRevision } from '../api/types';
import { api, qs } from '../api/client';
import { Button } from './Button';
import { cx } from '../lib/cx';

export interface ArtifactViewerArtifact {
  /** The artifact's key (work product `externalId`) — used to reconstruct the download fetch path. */
  key: string;
  title: string | null;
  /** The stored raw-serve URL (`/api/w/:ws/tickets/:id/artifacts/:key/raw`) — used verbatim for the
   * iframe, open-in-new-tab and copy-link actions. */
  url: string;
}

export function ArtifactViewer({
  ws, ticketId, artifact, revisions,
}: {
  ws: string;
  ticketId: string;
  artifact: ArtifactViewerArtifact;
  revisions: DocumentRevision[] | undefined;
}): React.ReactElement {
  const [revision, setRevision] = useState<number | undefined>(undefined);
  const [downloading, setDownloading] = useState(false);
  const [copied, setCopied] = useState(false);

  const src = `${artifact.url}${qs({ revision })}`;

  async function download(): Promise<void> {
    setDownloading(true);
    try {
      const [html, kitCss] = await Promise.all([
        api.ws<string>(ws, `/tickets/${ticketId}/artifacts/${artifact.key}/raw${qs({ revision })}`),
        api.ws<string>(ws, '/artifacts/kit.css'),
      ]);
      const inlined = html.includes(kitCss)
        ? html
        : /<\/head>/i.test(html)
          ? html.replace(/<\/head>/i, `<style>${kitCss}</style></head>`)
          : /<html[^>]*>/i.test(html)
            ? html.replace(/<html[^>]*>/i, (m) => `${m}<head><style>${kitCss}</style></head>`)
            : `<style>${kitCss}</style>${html}`;
      const blob = new Blob([inlined], { type: 'text/html' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${artifact.title || artifact.key}.html`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        {(revisions?.length ?? 0) > 1 ? (
          <>
            <span className="ac-label">Revisions</span>
            {(revisions ?? []).map((r) => (
              <button
                key={r.revision}
                type="button"
                onClick={() => setRevision(r.revision)}
                className={cx(
                  'ac-mono rounded-r4 border px-2 py-1 text-nano',
                  (revision ?? revisions![revisions!.length - 1]!.revision) === r.revision
                    ? 'border-accent-edge bg-accent-tint text-accent-link'
                    : 'border-line-2 text-text-3',
                )}
              >
                r{r.revision}
              </button>
            ))}
          </>
        ) : null}
        <span className="flex-1" />
        <a href={src} target="_blank" rel="noreferrer" className="text-micro">
          Open in new tab ↗
        </a>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => {
            if (typeof navigator.clipboard?.writeText !== 'function') return;
            navigator.clipboard.writeText(`${window.location.origin}${src}`).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }).catch(() => {});
          }}
        >
          {copied ? 'Copied' : 'Copy link'}
        </Button>
        <Button size="sm" variant="secondary" onClick={() => void download()} disabled={downloading}>
          {downloading ? 'Downloading…' : 'Download'}
        </Button>
      </div>

      <iframe
        key={src}
        src={src}
        sandbox="allow-scripts allow-forms allow-popups allow-downloads"
        title={artifact.title ?? artifact.key}
        className="h-[75vh] w-full rounded-r6 border border-line-1 bg-bg-0"
      />
    </div>
  );
}
