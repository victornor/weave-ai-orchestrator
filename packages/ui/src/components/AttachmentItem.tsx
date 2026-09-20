/**
 * One non-image attachment, presented by kind (VS-597): video and audio play in place with controls
 * and a download button, a PDF or text file opens in a new tab, anything else downloads. Every
 * download goes through `useAttachmentDownload`, so a failure shows an error and a Retry instead of
 * vanishing. Shared by the approval cards, the ticket page and chat so none keeps a bare link.
 */
import { attachmentDownloadName } from '@weave-ai/shared';
import { attachmentKindOf } from '@weave-ai/render';
import { useEffect, useRef, useState } from 'react';
import { ago } from '../lib/format';
import { cx } from '../lib/cx';
import { useAttachmentDownload } from '../lib/attachmentDownload';

export interface AttachmentItemProps {
  url: string;
  label: string;
  mediaType: string;
  byteSize: number;
  createdAt?: string;
  attachmentId?: string;
  className?: string;
}

const bytes = (n: number): string => `${n.toLocaleString()} bytes`;

export function AttachmentItem({ url, label, mediaType, byteSize, createdAt, attachmentId, className }: AttachmentItemProps): React.ReactElement {
  const kind = attachmentKindOf(mediaType);
  const name = attachmentDownloadName(label, mediaType);
  const dl = useAttachmentDownload(url, name);
  const [playFailed, setPlayFailed] = useState(false);
  // When the direct `src` fails (a request the page's session does not cover, or a type the element
  // refuses), the bytes are fetched by the page itself, which carries its session, and played from a blob.
  const [blobSrc, setBlobSrc] = useState<string | null>(null);
  const triedBlob = useRef(false);
  const blobRef = useRef<string | null>(null);
  useEffect(() => () => { if (blobRef.current) URL.revokeObjectURL(blobRef.current); }, []);
  const onMediaError = (): void => {
    if (triedBlob.current) { setPlayFailed(true); return; }
    triedBlob.current = true;
    fetch(url, { credentials: 'include' })
      .then((res) => { if (!res.ok) throw new Error(String(res.status)); return res.blob(); })
      .then((blob) => {
        blobRef.current = URL.createObjectURL(blob.type ? blob : new Blob([blob], { type: mediaType }));
        setBlobSrc(blobRef.current);
      })
      .catch(() => setPlayFailed(true));
  };
  const meta = [mediaType, bytes(byteSize), createdAt ? ago(createdAt) : null].filter(Boolean).join(' · ');

  const failure = dl.error ? (
    <div role="alert" className="flex flex-wrap items-center gap-2 text-nano text-blocked">
      <span>{dl.error}</span>
      <button type="button" onClick={() => void dl.start()} className="rounded-r4 border border-line-2 px-2 py-0.5 text-nano text-text-1">
        Retry
      </button>
    </div>
  ) : null;

  const downloadButton = (
    <button
      type="button"
      disabled={dl.busy}
      onClick={() => void dl.start()}
      aria-label={`Download ${name}`}
      className="flex-none rounded-r4 border border-line-2 px-2 py-0.5 text-nano text-text-1 hover:border-accent-edge disabled:opacity-60"
    >
      {dl.busy ? 'Downloading…' : 'Download'}
    </button>
  );

  const caption = (
    <div className="flex items-center gap-2">
      <div className="min-w-0 flex-1">
        <div className="truncate text-micro text-text-1">{label}</div>
        <div className="ac-mono truncate text-nano text-text-3">{meta}</div>
      </div>
      {downloadButton}
    </div>
  );

  if (kind === 'video' || kind === 'audio') {
    const shared = { controls: true, preload: 'metadata' as const, src: blobSrc ?? url, 'aria-label': label, onError: onMediaError };
    return (
      <div data-attachment={attachmentId} data-attachment-kind={kind} className={cx('flex w-full max-w-md flex-col gap-1.5 rounded-r4 border border-line-2 p-1.5', className)}>
        {kind === 'video' ? (
          <video {...shared} playsInline className="max-h-64 w-full rounded-r4 bg-black" />
        ) : (
          <audio {...shared} className="w-full" />
        )}
        {playFailed ? <div className="text-nano text-text-2">This {kind} cannot be played here. Download it instead.</div> : null}
        {caption}
        {failure}
      </div>
    );
  }

  if (kind === 'pdf' || kind === 'text') {
    return (
      <div data-attachment={attachmentId} data-attachment-kind={kind} className={cx('flex w-full max-w-72 flex-col gap-1.5 rounded-r4 border border-line-2 px-2 py-1.5', className)}>
        {caption}
        <a href={`${url}${url.includes('?') ? '&' : '?'}inline=1`} target="_blank" rel="noreferrer" className="text-nano text-accent-link underline">
          Open in new tab
        </a>
        {failure}
      </div>
    );
  }

  return (
    <div data-attachment={attachmentId} data-attachment-kind={kind} className={cx('flex max-w-72 flex-col gap-1 rounded-r4 border border-line-2 px-2 py-1.5', className)}>
      <a
        href={url}
        download={name}
        title={label}
        onClick={(e) => {
          e.preventDefault();
          void dl.start();
        }}
        className="flex flex-col gap-0.5"
      >
        <span className="truncate text-micro text-text-1">{label}</span>
        <span className="ac-mono text-nano text-text-3">{meta} · {dl.busy ? 'downloading…' : 'download'}</span>
      </a>
      {failure}
    </div>
  );
}
