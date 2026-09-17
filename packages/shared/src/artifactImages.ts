import type { AttachmentImageType } from './attachments.js';

const HEADER = /data:(image\/(?:png|jpeg|gif|webp));base64,/ig;
const B64 = /^[A-Za-z0-9+/]*={0,2}$/;
const END = new Set(['"', "'", ' ', '\t', '\r', '\n', '<', '>', ')']);

function decodeBase64(value: string): Uint8Array | null {
  if (!value || value.length % 4 !== 0 || !B64.test(value)) return null;
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
  const out = new Uint8Array((value.length / 4) * 3 - padding);
  let at = 0;
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  for (let i = 0; i < value.length; i += 4) {
    const a = alphabet.indexOf(value[i]!); const b = alphabet.indexOf(value[i + 1]!);
    const c = value[i + 2] === '=' ? 0 : alphabet.indexOf(value[i + 2]!);
    const d = value[i + 3] === '=' ? 0 : alphabet.indexOf(value[i + 3]!);
    if (a < 0 || b < 0 || c < 0 || d < 0 || (i + 4 < value.length && (value[i + 2] === '=' || value[i + 3] === '='))) return null;
    if (at < out.length) out[at++] = (a << 2) | (b >> 4);
    if (at < out.length) out[at++] = ((b & 15) << 4) | (c >> 2);
    if (at < out.length) out[at++] = ((c & 3) << 6) | d;
  }
  return out;
}

function complete(type: AttachmentImageType, bytes: Uint8Array): boolean {
  if (type === 'image/jpeg') return bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff && bytes[bytes.length - 2] === 0xff && bytes[bytes.length - 1] === 0xd9;
  if (type === 'image/gif') return bytes.length >= 7 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[bytes.length - 1] === 0x3b;
  if (type === 'image/webp') {
    if (bytes.length < 12 || bytes[0] !== 0x52 || bytes[1] !== 0x49 || bytes[2] !== 0x46 || bytes[3] !== 0x46 || bytes[8] !== 0x57 || bytes[9] !== 0x45 || bytes[10] !== 0x42 || bytes[11] !== 0x50) return false;
    const size = bytes[4]! | (bytes[5]! << 8) | (bytes[6]! << 16) | (bytes[7]! << 24);
    return size + 8 === bytes.length;
  }
  if (bytes.length < 26 || bytes[0] !== 0x89 || bytes[1] !== 0x50 || bytes[2] !== 0x4e || bytes[3] !== 0x47) return false;
  let offset = 8; let sawIend = false;
  while (offset + 12 <= bytes.length) {
    const length = (bytes[offset]! << 24) | (bytes[offset + 1]! << 16) | (bytes[offset + 2]! << 8) | bytes[offset + 3]!;
    if (length < 0 || offset + 12 + length > bytes.length) return false;
    const chunk = String.fromCharCode(bytes[offset + 4]!, bytes[offset + 5]!, bytes[offset + 6]!, bytes[offset + 7]!);
    offset += 12 + length;
    if (chunk === 'IEND') { sawIend = true; break; }
  }
  return sawIend && offset === bytes.length;
}

/** Validates every supported raster data URI embedded in an artifact. */
export function validateArtifactImageDataUris(html: string): void {
  HEADER.lastIndex = 0;
  let match: RegExpExecArray | null; let occurrence = 0;
  while ((match = HEADER.exec(html))) {
    occurrence += 1;
    const type = match[1] as AttachmentImageType;
    const start = HEADER.lastIndex;
    let end = start;
    while (end < html.length && !END.has(html[end]!)) end += 1;
    if (end < html.length && !END.has(html[end]!)) throw new Error(`embedded image #${occurrence} (${type}) contains an invalid character`);
    const payload = html.slice(start, end);
    const bytes = decodeBase64(payload);
    if (!bytes || !complete(type, bytes)) throw new Error(`embedded image #${occurrence} (${type}) is malformed or incomplete`);
  }
}
