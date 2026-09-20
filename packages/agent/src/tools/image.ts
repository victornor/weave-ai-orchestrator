/**
 * Image reading for the built-in agent (runtime-details section 5, S8). The type is decided by the
 * bytes, never the extension, and only the four formats the design names are read.
 */
import { closeSync, openSync, readSync } from 'node:fs';
import type { ImagePart } from '../types.js';

export const IMAGE_MAX_BYTES = 5 * 1024 * 1024;

/** The media type of an image header, or null when it is not one of the four supported formats. */
export function detectImageType(buf: Buffer): string | null {
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png';
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length >= 4 && buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38) return 'image/gif';
  if (buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

/** Read at most `n` bytes from the start of a file, without loading the whole thing. */
export function readHeader(path: string, n = 16): Buffer {
  const buf = Buffer.alloc(n);
  const fd = openSync(path, 'r');
  try { const read = readSync(fd, buf, 0, n, 0); return buf.subarray(0, read); } finally { closeSync(fd); }
}

export function imagePart(mediaType: string, data: Buffer): ImagePart {
  return { mediaType, dataBase64: data.toString('base64') };
}
