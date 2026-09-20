/** A `ThreadMessage`'s `attachment` parts, turned into what a transcript renders (VS-133). */
import { isAttachmentImageType, isAttachmentTextType, type AttachmentPart } from '@weave-ai/shared';
import { formatBytes } from './format.js';

export interface AttachmentView {
  id: string;
  filename: string;
  mediaType: string;
  byteSize: number;
  /** `image` gets a thumbnail; `text` and `other` get a filename chip with a download link. */
  kind: 'image' | 'text' | 'other';
  sizeLabel: string;
}

function isAttachmentPart(p: unknown): p is AttachmentPart {
  if (typeof p !== 'object' || p === null) return false;
  const r = p as Record<string, unknown>;
  return r.type === 'attachment' && typeof r.id === 'string' && typeof r.filename === 'string'
    && typeof r.mediaType === 'string' && typeof r.byteSize === 'number';
}

/** `ThreadMessage.parts` is opaque JSON (`unknown[]`) — this is the one place that trusts it. */
export function attachmentPartsOf(parts: unknown[] | null | undefined): AttachmentPart[] {
  return Array.isArray(parts) ? parts.filter(isAttachmentPart) : [];
}

export function attachmentToView(part: AttachmentPart): AttachmentView {
  const kind = isAttachmentImageType(part.mediaType) ? 'image' : isAttachmentTextType(part.mediaType) ? 'text' : 'other';
  return { id: part.id, filename: part.filename, mediaType: part.mediaType, byteSize: part.byteSize, kind, sizeLabel: formatBytes(part.byteSize) };
}

export type AttachmentKind = 'image' | 'video' | 'audio' | 'pdf' | 'text' | 'other';

/**
 * How a surface presents an attachment, from its media type alone (VS-597), so a card, the ticket
 * page and chat cannot disagree. SVG is `other`: it is never previewed or opened inline.
 */
export function attachmentKindOf(mediaType: string): AttachmentKind {
  const t = mediaType.toLowerCase();
  if (t === 'image/svg+xml') return 'other';
  if (t.startsWith('image/')) return 'image';
  if (t.startsWith('video/')) return 'video';
  if (t.startsWith('audio/')) return 'audio';
  if (t === 'application/pdf') return 'pdf';
  if (t === 'text/plain' || t === 'text/markdown') return 'text';
  return 'other';
}
