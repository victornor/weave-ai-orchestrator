/**
 * The accepted-type/size policy for a conductor chat attachment (VS-133), chosen from evidence read
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
  txt: 'text/plain', md: 'text/markdown',
};

/** Guesses a media type for an outbound single-file attachment from its filename's extension. */
export function guessOutboundMediaType(filename: string): string {
  const dot = filename.lastIndexOf('.');
  if (dot < 0 || dot === filename.length - 1) return 'application/octet-stream';
  const ext = filename.slice(dot + 1).toLowerCase();
  return OUTBOUND_EXTENSION_MEDIA_TYPES[ext] ?? 'application/octet-stream';
}
