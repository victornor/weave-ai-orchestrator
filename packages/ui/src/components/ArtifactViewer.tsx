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
  /** The artifact's key (work product `externalId`) — display use only; the download fetch reads `url` directly (VS-297). */
  key: string;
  title: string | null;
  /** The raw-serve URL, already carrying its full `/api/w/:ws/...` prefix (`/tickets/:id/artifacts/:key/raw`
   * for a ticket artifact, `/artifacts/:key/raw` for a workspace-scoped one) — used verbatim for the
   * iframe, open-in-new-tab, copy-link *and* download actions. Never re-prefix it through `api.ws`. */
  url: string;
}

/**
 * VS-331: the only shape the raw-serve routes produce is a same-origin `/api/w/<ws>/…/raw` path
 * (optionally with a `?revision=` query). Anything else — an empty string, a `file://` folder a
 * pre-VS-269 work product recorded — cannot be framed or fetched, so the viewer must say so rather
 * than mount a blank iframe and dead actions.
 */
export function isPreviewableArtifactUrl(url: string, ws: string): boolean {
  if (!url) return false;
  const path = url.split('?')[0] ?? '';
  return path.startsWith(`/api/w/${ws}/`) && path.endsWith('/raw');
}

export function ArtifactViewer({
  ws, artifact, revisions,
}: {
  ws: string;
  /** Omitted for a workspace-scoped artifact (VS-297), which has no ticket at all; unused by this
   * component itself (kept on the prop type for callers that still pass it, e.g. the ticket Artifact
   * tab), since `download()` now reads `artifact.url` directly instead of reconstructing a ticket path. */
  ticketId?: string;
  artifact: ArtifactViewerArtifact;
  revisions: DocumentRevision[] | undefined;
}): React.ReactElement {
  const [revision, setRevision] = useState<number | undefined>(undefined);
  const [downloading, setDownloading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const previewable = isPreviewableArtifactUrl(artifact.url, ws);
  const src = `${artifact.url}${qs({ revision })}`;
  // `artifact.url` already carries the `/api/w/:ws` prefix `api.ws` itself adds — strip it back off so
  // a fetch-based read goes through the same helper (auth headers, error handling) without doubling
  // the prefix (see [[ticket-artifacts]] knowledge doc). Works unchanged for either artifact shape,
  // since it derives the path from the URL rather than reconstructing one from a ticket id.
  const relativePath = artifact.url.startsWith(`/api/w/${ws}`) ? artifact.url.slice(`/api/w/${ws}`.length) : artifact.url;

  async function download(): Promise<void> {
    setDownloading(true);
    setError(null);
    try {
      const [html, kitCss] = await Promise.all([
        api.ws<string>(ws, `${relativePath}${qs({ revision })}`),
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
    } catch (e) {
      // VS-331: a swallowed failure left the button looking like it did something.
      setError(e instanceof Error ? e.message : 'The download failed.');
    } finally {
      setDownloading(false);
    }
  }

  // VS-331: a link-only artifact (no stored document) has nothing to frame, fetch or link to. Say so
  // explicitly and keep every action inert, rather than rendering a blank frame with dead buttons.
  if (!previewable) {
    return (
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="flex-1" />
          <span className="text-micro text-text-4" aria-disabled="true">Open in new tab ↗</span>
          <Button size="sm" variant="secondary" disabled>Copy link</Button>
          <Button size="sm" variant="secondary" disabled>Download</Button>
        </div>
        <div className="ac-card p-3.5">
          <p className="text-meta font-medium text-text-2">This artifact has no stored content to preview.</p>
          {artifact.url ? <p className="ac-mono mt-1 break-all text-micro text-text-4">{artifact.url}</p> : null}
        </div>
      </div>
    );
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

      {error ? <p role="alert" className="text-micro text-failed">Download failed: {error}</p> : null}

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
