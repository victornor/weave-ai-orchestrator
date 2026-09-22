import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { Wakeup } from '@weave-ai/shared';
import type { CoreServices } from '../api.js';
import { materializeRunAttachments, runAttachmentDir, writeAttachmentFile } from './attachments.js';

const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });
function tempHome(): string { const d = mkdtempSync(join(tmpdir(), 'ac-attach-')); dirs.push(d); return join(d, 'agent-home'); }

/** A `CoreServices` stub whose threads service resolves the named attachments (a missing one throws). */
function depsWith(atts: Record<string, { mediaType: string; bytes: Buffer; filename?: string }>): CoreServices {
  return {
    threads: {
      attachment: (_threadId: string, id: string) => {
        const a = atts[id];
        if (!a) throw new Error(`attachment ${id} not found`);
        return {
          attachment: { id, threadId: 't1', messageId: 'm1', filename: a.filename ?? `${id}.png`, mediaType: a.mediaType, byteSize: a.bytes.length, storageKey: 'k', createdAt: 'now' },
          bytes: a.bytes,
        };
      },
    },
  } as unknown as CoreServices;
}

const wake = (ids: string[]): Wakeup => ({ id: 'w', workspaceId: 'ws', agentId: 'a', source: 'human_message', reason: 'r', payload: { threadId: 't1', attachmentIds: ids }, status: 'claimed' }) as unknown as Wakeup;

describe('readable attachment files (VS-659)', () => {
  it('writes an image under the agent home and returns its readable absolute path', () => {
    const homePath = tempHome();
    mkdirSync(homePath, { recursive: true });
    const m = materializeRunAttachments(depsWith({ att_1: { mediaType: 'image/png', bytes: Buffer.from([1, 2, 3]) } }), homePath, 'run-1', [wake(['att_1'])]);
    const path = m.paths['att_1'];
    expect(path).toBeDefined();
    expect(path!.startsWith(join(homePath, '.weave-attachments', 'run-1'))).toBe(true);
    expect(existsSync(path!)).toBe(true);
    expect(readFileSync(path!)).toEqual(Buffer.from([1, 2, 3]));
  });

  it('skips a text document and a deleted attachment', () => {
    const homePath = tempHome();
    mkdirSync(homePath, { recursive: true });
    const m = materializeRunAttachments(
      depsWith({ att_txt: { mediaType: 'text/plain', bytes: Buffer.from('hi') } }),
      homePath, 'run-1', [wake(['att_txt', 'att_gone'])],
    );
    expect(Object.keys(m.paths)).toEqual([]);
  });

  it('prunes a prior run directory once a new run writes its own', () => {
    const homePath = tempHome();
    mkdirSync(homePath, { recursive: true });
    writeAttachmentFile(runAttachmentDir(homePath, 'run-old'), { id: 'old', filename: 'old.png' }, Buffer.from([9]));
    expect(existsSync(runAttachmentDir(homePath, 'run-old'))).toBe(true);

    materializeRunAttachments(depsWith({ att_1: { mediaType: 'image/png', bytes: Buffer.from([1]) } }), homePath, 'run-new', [wake(['att_1'])]);

    expect(existsSync(runAttachmentDir(homePath, 'run-old'))).toBe(false);
    expect(existsSync(runAttachmentDir(homePath, 'run-new'))).toBe(true);
  });
});