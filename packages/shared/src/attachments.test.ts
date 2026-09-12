import { describe, expect, it } from 'vitest';
import {
  ATTACHMENT_MAX_IMAGE_BYTES, ATTACHMENT_MAX_OUTBOUND_FILE_BYTES, ATTACHMENT_MAX_PER_MESSAGE, ATTACHMENT_MAX_TEXT_BYTES,
  ATTACHMENT_MAX_ZIP_INPUT_BYTES, ATTACHMENT_ZIP_MEDIA_TYPE,
  attachmentMaxBytes, guessOutboundMediaType, isAttachmentImageType, isAttachmentTextType, sniffImageType,
} from './attachments.js';

describe('attachment policy constants', () => {
  it('matches the values design.md commits to', () => {
    expect(ATTACHMENT_MAX_IMAGE_BYTES).toBe(5 * 1024 * 1024);
    expect(ATTACHMENT_MAX_TEXT_BYTES).toBe(256 * 1024);
    expect(ATTACHMENT_MAX_PER_MESSAGE).toBe(4);
  });

  it('classifies accepted types and rejects everything else', () => {
    expect(isAttachmentImageType('image/png')).toBe(true);
    expect(isAttachmentImageType('application/pdf')).toBe(false);
    expect(isAttachmentTextType('text/markdown')).toBe(true);
    expect(isAttachmentTextType('application/json')).toBe(false);
    expect(attachmentMaxBytes('image/webp')).toBe(ATTACHMENT_MAX_IMAGE_BYTES);
    expect(attachmentMaxBytes('text/plain')).toBe(ATTACHMENT_MAX_TEXT_BYTES);
    expect(attachmentMaxBytes('application/pdf')).toBeNull();
  });
});

describe('sniffImageType', () => {
  it('recognises each accepted image signature', () => {
    expect(sniffImageType(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]))).toBe('image/png');
    expect(sniffImageType(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]))).toBe('image/jpeg');
    expect(sniffImageType(Uint8Array.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]))).toBe('image/gif');
    const webp = new Uint8Array(16);
    webp.set([0x52, 0x49, 0x46, 0x46], 0);
    webp.set([0, 0, 0, 0], 4);
    webp.set([0x57, 0x45, 0x42, 0x50], 8);
    expect(sniffImageType(webp)).toBe('image/webp');
  });

  it('returns null for a mislabelled or unrecognised file', () => {
    expect(sniffImageType(Uint8Array.from([0x25, 0x50, 0x44, 0x46]))).toBeNull(); // %PDF
    expect(sniffImageType(new Uint8Array(0))).toBeNull();
  });
});

describe('outbound-only additions (VS-273) leave the inbound policy untouched', () => {
  it('attachmentMaxBytes is unchanged for every existing input — zip is still not an inbound type', () => {
    expect(attachmentMaxBytes('image/png')).toBe(ATTACHMENT_MAX_IMAGE_BYTES);
    expect(attachmentMaxBytes('text/markdown')).toBe(ATTACHMENT_MAX_TEXT_BYTES);
    expect(attachmentMaxBytes('application/zip')).toBeNull(); // a human still cannot upload a zip
    expect(attachmentMaxBytes('application/pdf')).toBeNull();
  });

  it('defines the zip media type and outbound caps as new, separate constants', () => {
    expect(ATTACHMENT_ZIP_MEDIA_TYPE).toBe('application/zip');
    expect(ATTACHMENT_MAX_OUTBOUND_FILE_BYTES).toBeGreaterThan(0);
    expect(ATTACHMENT_MAX_ZIP_INPUT_BYTES).toBeGreaterThan(ATTACHMENT_MAX_OUTBOUND_FILE_BYTES);
  });

  it('guesses a media type from the extension, reusing the existing image/text classification', () => {
    expect(guessOutboundMediaType('screenshot.png')).toBe('image/png');
    expect(guessOutboundMediaType('notes.md')).toBe('text/markdown');
    expect(guessOutboundMediaType('report.TXT')).toBe('text/plain'); // case-insensitive
    expect(guessOutboundMediaType('index.css')).toBe('application/octet-stream');
    expect(guessOutboundMediaType('no-extension')).toBe('application/octet-stream');
  });
});
