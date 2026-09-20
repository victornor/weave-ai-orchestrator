import { createHash } from 'node:crypto';
import { attachmentContentDisposition, attachmentDownloadName, detectAttachmentMediaType } from '@weave-ai/shared';

export interface ServedAttachment {
  bytes: Buffer;
  /** The stored media type; refined when it is `application/octet-stream` (VS-597). */
  mediaType: string;
  /** The attachment's label or filename; gets the media type's extension when it has none. */
  filename: string;
  /** Content hash, when the row carries one; otherwise computed from the bytes. */
  sha256?: string | null;
}

type Range = { start: number; end: number } | 'unsatisfiable' | null;

/** A single `bytes=` range; multi-range and malformed headers are ignored (served whole), as the RFC allows. */
function parseRange(header: string | null, size: number): Range {
  const m = header ? /^bytes=(\d*)-(\d*)$/.exec(header.trim()) : null;
  if (!m) return null;
  const [, a = '', b = ''] = m;
  if (a === '' && b === '') return null;
  if (a === '') {
    const n = Number(b);
    if (n === 0) return 'unsatisfiable';
    return size === 0 ? 'unsatisfiable' : { start: Math.max(0, size - n), end: size - 1 };
  }
  const start = Number(a);
  if (start >= size) return 'unsatisfiable';
  const end = b === '' ? size - 1 : Math.min(Number(b), size - 1);
  return end < start ? null : { start, end };
}

/**
 * The one place that sets headers for stored attachment bytes (VS-597): the length is the bytes
 * actually sent, the name is RFC 5987 and carries an extension, an `octet-stream` type is refined,
 * ranges answer 206/416, and the ETag makes a repeat fetch a 304. `HEAD` gets the GET headers, no body.
 */
export function serveBytes(request: Request, file: ServedAttachment): Response {
  const { bytes } = file;
  const mediaType = detectAttachmentMediaType({ stored: file.mediaType, filename: file.filename, bytes });
  const etag = `"${file.sha256 ?? createHash('sha256').update(bytes).digest('hex')}"`;
  const inline = new URL(request.url).searchParams.get('inline') === '1';
  const headers: Record<string, string> = {
    'content-type': mediaType,
    'content-disposition': attachmentContentDisposition(mediaType, attachmentDownloadName(file.filename, mediaType), { inline }),
    'x-content-type-options': 'nosniff',
    'accept-ranges': 'bytes',
    etag,
    'cache-control': 'private, max-age=3600',
  };
  const head = request.method === 'HEAD';

  if (request.headers.get('if-none-match')?.split(',').some((t) => t.trim() === etag || t.trim() === `W/${etag}`)) {
    return new Response(null, { status: 304, headers: { etag, 'cache-control': headers['cache-control']! } });
  }
  // A stale `If-Range` means the client's partial copy is of other bytes: send the whole thing.
  const ifRange = request.headers.get('if-range');
  const range = ifRange && ifRange !== etag ? null : parseRange(request.headers.get('range'), bytes.byteLength);
  if (range === 'unsatisfiable') {
    return new Response(null, { status: 416, headers: { ...headers, 'content-range': `bytes */${bytes.byteLength}`, 'content-length': '0' } });
  }
  if (range) {
    const slice = bytes.subarray(range.start, range.end + 1);
    return new Response(head ? null : (slice as unknown as ArrayBuffer), { status: 206, headers: {
      ...headers, 'content-range': `bytes ${range.start}-${range.end}/${bytes.byteLength}`, 'content-length': String(slice.byteLength),
    } });
  }
  return new Response(head ? null : (bytes as unknown as ArrayBuffer), { status: 200, headers: { ...headers, 'content-length': String(bytes.byteLength) } });
}
