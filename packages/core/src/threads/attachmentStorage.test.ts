import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readAttachmentBytes, sanitizeAttachmentFilename, writeAttachment } from './attachmentStorage.js';
import type { WorkspaceContext } from '../context.js';

let root: string;
let ctx: WorkspaceContext;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'ac-attachments-'));
  ctx = { paths: { attachments: join(root, 'attachments') } } as WorkspaceContext;
});
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

describe('writeAttachment / readAttachmentBytes', () => {
  it('round-trips bytes under a server-generated name, never the caller-supplied one', () => {
    const bytes = Buffer.from('hello attachment');
    const stored = writeAttachment(ctx, 'text/plain', bytes);
    expect(stored.storageKey).toMatch(/^[0-9A-Z]+\.txt$/);
    expect(stored.byteSize).toBe(bytes.byteLength);
    expect(readAttachmentBytes(ctx, stored.storageKey)).toEqual(bytes);
  });

  it('rejects bytes over the media type cap even if the caller skipped the check', () => {
    const oversized = Buffer.alloc(256 * 1024 + 1);
    expect(() => writeAttachment(ctx, 'text/plain', oversized)).toThrow(/exceeds the size cap/);
  });

  it('derives the extension from the media type, not from any client input', () => {
    const stored = writeAttachment(ctx, 'image/png', Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    expect(stored.storageKey.endsWith('.png')).toBe(true);
  });
});

describe('sanitizeAttachmentFilename', () => {
  it('strips control characters and caps the length, but is display-only — it never builds a path', () => {
    expect(sanitizeAttachmentFilename('report\x00.txt')).toBe('report.txt');
    expect(sanitizeAttachmentFilename('../../etc/passwd')).toBe('../../etc/passwd');
    expect(sanitizeAttachmentFilename('a'.repeat(300)).length).toBe(200);
  });

  it('falls back to a placeholder for an empty or all-control name', () => {
    expect(sanitizeAttachmentFilename('\x00\x01')).toBe('attachment');
  });
});
