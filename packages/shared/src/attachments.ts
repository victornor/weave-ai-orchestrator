/**
 * The accepted-type/size policy for a weave chat attachment (VS-133), chosen from evidence read
 * out of the installed `claude` CLI's own strings rather than picked arbitrarily: the image cap
 * matches the CLI's own paste-image feature (`maxBase64Size: 5242880`); the text cap bounds how much
 * of the conductor's context one inlined document can spend. See openspec design.md — Decision 2.
 */
export const ATTACHMENT_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'] as const;
export const ATTACHMENT_TEXT_TYPES = ['text/plain', 'text/markdown'] as const;
export type AttachmentImageType = (typeof ATTACHMENT_IMAGE_TYPES)[number];
export type AttachmentTextType = (typeof ATTACHMENT_TEXT_TYPES)[number];
export type AttachmentMediaType = AttachmentImageType | AttachmentTextType;

export const ATTACHMENT_MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const ATTACHMENT_MAX_TEXT_BYTES = 256 * 1024;
export const ATTACHMENT_MAX_PER_MESSAGE = 4;

/** Storage extension per accepted media type — never derived from the client's filename. */
export const ATTACHMENT_EXTENSIONS: Record<AttachmentMediaType, string> = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp',
  'text/plain': 'txt', 'text/markdown': 'md',
};

export function isAttachmentImageType(mediaType: string): mediaType is AttachmentImageType {
  return (ATTACHMENT_IMAGE_TYPES as readonly string[]).includes(mediaType);
}
export function isAttachmentTextType(mediaType: string): mediaType is AttachmentTextType {
  return (ATTACHMENT_TEXT_TYPES as readonly string[]).includes(mediaType);
}
export function attachmentMaxBytes(mediaType: string): number | null {
  if (isAttachmentImageType(mediaType)) return ATTACHMENT_MAX_IMAGE_BYTES;
  if (isAttachmentTextType(mediaType)) return ATTACHMENT_MAX_TEXT_BYTES;
  return null;
}

/** Magic-byte signatures for the accepted image types — verified against the declared type before it is trusted. */
const IMAGE_SIGNATURES: Array<{ type: AttachmentImageType; bytes: number[] }> = [
  { type: 'image/png', bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { type: 'image/jpeg', bytes: [0xff, 0xd8, 0xff] },
  { type: 'image/gif', bytes: [0x47, 0x49, 0x46, 0x38] },
];

/** WebP is `RIFF....WEBP`: bytes 0-3 and 8-11, with a 4-byte size field between them. */
function isWebp(bytes: Uint8Array): boolean {
  if (bytes.length < 12) return false;
  const riff = [0x52, 0x49, 0x46, 0x46];
  const webp = [0x57, 0x45, 0x42, 0x50];
  return riff.every((b, i) => bytes[i] === b) && webp.every((b, i) => bytes[8 + i] === b);
}

/** Sniffs the actual image type from its leading bytes; `null` when nothing accepted matches. */
export function sniffImageType(bytes: Uint8Array): AttachmentImageType | null {
  for (const sig of IMAGE_SIGNATURES) if (sig.bytes.every((b, i) => bytes[i] === b)) return sig.type;
  if (isWebp(bytes)) return 'image/webp';
  return null;
}

/**
 * Outbound-only (VS-273, openspec design.md — Decision 6): a weaver reply attaches a file it already
 * read off disk, not one an untrusted client uploaded, so this deliberately does not reuse
 * `attachmentMaxBytes()`/`ATTACHMENT_MAX_IMAGE_BYTES`/`ATTACHMENT_MAX_TEXT_BYTES` above — those exist
 * for a different reason (a paste-image limit and a context-budget bound) that does not apply here,
 * and reusing them would leave the inbound multipart route's own behavior for these values unchanged
 * only by accident. Keeping them separate is what keeps that route's accepted-type policy untouched.
 */
export const ATTACHMENT_MAX_OUTBOUND_FILE_BYTES = 10 * 1024 * 1024;
/** Cap on the combined input to one zip bundle, before the `store`-method container's small per-entry overhead. */
export const ATTACHMENT_MAX_ZIP_INPUT_BYTES = 40 * 1024 * 1024;
/** The only media type a zip attachment ever carries; never accepted on the inbound route. */
export const ATTACHMENT_ZIP_MEDIA_TYPE = 'application/zip';

/**
 * Extension -> media type for a single outbound file, whose type the weaver never declares (unlike
 * the inbound route, where the human's browser does and the server verifies it against the file's own
 * bytes). Deliberately reuses the same four image and two text types `packages/render` already
 * classifies specially, so a `.png` read from `knowledge/` renders as an inline thumbnail exactly like
 * an inbound one — no new rendering rule to maintain. Anything else, including every zip, falls back to
 * `application/octet-stream`, which renders as the existing filename+size download chip.
 */
const OUTBOUND_EXTENSION_MEDIA_TYPES: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
  txt: 'text/plain', md: 'text/markdown', log: 'text/plain', json: 'application/json', csv: 'text/csv',
  pdf: 'application/pdf', zip: 'application/zip',
  mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', mkv: 'video/x-matroska',
  mp3: 'audio/mpeg', m4a: 'audio/mp4', wav: 'audio/wav', ogg: 'audio/ogg', oga: 'audio/ogg', opus: 'audio/ogg', flac: 'audio/flac',
};

/** Guesses a media type for an outbound single-file attachment from its filename's extension. */
export function guessOutboundMediaType(filename: string): string {
  const dot = filename.lastIndexOf('.');
  if (dot < 0 || dot === filename.length - 1) return 'application/octet-stream';
  const ext = filename.slice(dot + 1).toLowerCase();
  return OUTBOUND_EXTENSION_MEDIA_TYPES[ext] ?? 'application/octet-stream';
}

const OCTET_STREAM = 'application/octet-stream';
const startsWithBytes = (bytes: Uint8Array, at: number, sig: number[]): boolean => sig.every((b, i) => bytes[at + i] === b);
const ascii = (s: string): number[] => [...s].map((c) => c.charCodeAt(0));

/** Sniffs a non-image type (video, audio, pdf, zip) from leading bytes; `null` when nothing matches. */
function sniffMediaType(bytes: Uint8Array): string | null {
  const image = sniffImageType(bytes);
  if (image) return image;
  if (bytes.length >= 12 && startsWithBytes(bytes, 4, ascii('ftyp'))) {
    const brand = String.fromCharCode(...bytes.slice(8, 12));
    if (brand === 'qt  ') return 'video/quicktime';
    if (brand.startsWith('M4A')) return 'audio/mp4';
    return 'video/mp4';
  }
  if (startsWithBytes(bytes, 0, [0x1a, 0x45, 0xdf, 0xa3])) return 'video/webm';
  if (startsWithBytes(bytes, 0, ascii('%PDF-'))) return 'application/pdf';
  if (startsWithBytes(bytes, 0, [0x50, 0x4b, 0x03, 0x04])) return 'application/zip';
  if (startsWithBytes(bytes, 0, ascii('OggS'))) return 'audio/ogg';
  if (startsWithBytes(bytes, 0, ascii('fLaC'))) return 'audio/flac';
  if (startsWithBytes(bytes, 0, ascii('ID3')) || (bytes[0] === 0xff && ((bytes[1] ?? 0) & 0xe0) === 0xe0)) return 'audio/mpeg';
  if (bytes.length >= 12 && startsWithBytes(bytes, 0, ascii('RIFF')) && startsWithBytes(bytes, 8, ascii('WAVE'))) return 'audio/wav';
  return null;
}

/**
 * The media type to serve or store (VS-597). A specific stored type is trusted; only a missing or
 * `application/octet-stream` one is refined, from the leading bytes first and the filename's extension
 * second. Never yields `text/html` or SVG, so refining can never make an attachment renderable script.
 */
export function detectAttachmentMediaType(input: { stored?: string | null; filename?: string; bytes?: Uint8Array }): string {
  const stored = (input.stored ?? '').trim().toLowerCase();
  if (stored && stored !== OCTET_STREAM) return stored;
  const sniffed = input.bytes ? sniffMediaType(input.bytes) : null;
  if (sniffed) return sniffed;
  const guessed = input.filename ? guessOutboundMediaType(input.filename) : OCTET_STREAM;
  return guessed;
}

const MEDIA_TYPE_EXTENSIONS: Record<string, string> = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp',
  'text/plain': 'txt', 'text/markdown': 'md', 'text/csv': 'csv', 'application/json': 'json',
  'application/pdf': 'pdf', 'application/zip': 'zip',
  'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/webm': 'webm', 'video/x-matroska': 'mkv',
  'audio/mpeg': 'mp3', 'audio/mp4': 'm4a', 'audio/wav': 'wav', 'audio/ogg': 'ogg', 'audio/flac': 'flac',
};

/** The name a served attachment is saved as: the label, plus the media type's extension when the label has none. */
export function attachmentDownloadName(label: string, mediaType: string): string {
  const ext = MEDIA_TYPE_EXTENSIONS[mediaType.toLowerCase()];
  const name = label.trim() || 'attachment';
  if (!ext) return name;
  const dot = name.lastIndexOf('.');
  const current = dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
  // A dot inside a phrase like "source -> 1920x1080" is not an extension: only a short alphanumeric tail is.
  if (/^[a-z0-9]{1,5}$/.test(current) && OUTBOUND_EXTENSION_MEDIA_TYPES[current] !== undefined) return name;
  return `${name}.${ext}`;
}

/** Media types safe to display in the browser itself: never HTML or SVG, so they cannot run script. */
export function isAttachmentInlineSafe(mediaType: string): boolean {
  const t = mediaType.toLowerCase();
  if (t === 'image/svg+xml') return false;
  return t.startsWith('image/') || t.startsWith('video/') || t.startsWith('audio/') || t === 'application/pdf' || t === 'text/plain' || t === 'text/markdown';
}

/**
 * RFC 5987 `ext-value` for a filename: `encodeURIComponent` leaves `!'()*` unescaped, but those are
 * not `attr-char`s, so a strict parser would reject the header — encode them too.
 */
function encode5987(value: string): string {
  return encodeURIComponent(value).replace(/['()*!]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

/**
 * The `Content-Disposition` value for a served attachment (VS-528). An image is `inline` so the chat
 * can preview it; everything else is a named download, like the ticket-attachment route. A header
 * value must be Latin-1 and Node throws `ERR_INVALID_CHAR` on anything else, so the plain `filename`
 * is reduced to printable ASCII (quotes and backslashes included, which would end the quoted string)
 * and the attachment's true display name is carried in the RFC 5987 `filename*` form instead.
 */
export function attachmentContentDisposition(mediaType: string, filename: string, opts: { inline?: boolean } = {}): string {
  if (mediaType.startsWith('image/') && mediaType !== 'image/svg+xml') return 'inline';
  if (opts.inline && isAttachmentInlineSafe(mediaType)) return `inline; filename="${filename.replace(/[^\x20-\x7e]|["\\]/g, '_')}"; filename*=UTF-8''${encode5987(filename)}`;
  const ascii = filename.replace(/[^\x20-\x7e]|["\\]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encode5987(filename)}`;
}
