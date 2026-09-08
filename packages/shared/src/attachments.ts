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
