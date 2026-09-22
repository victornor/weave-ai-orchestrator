/**
 * VS-659: the readable-path form of an image attachment. A runtime that cannot be shown an MCP
 * `image` block gets the bytes written to a file it can read instead — inside the agent's own home
 * (which the built-in file tools allow, and which is never a worker's worktree), under a per-run
 * directory, named in the turn prompt and reported by `weave_inbox` from the same computed path.
 */
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { isAttachmentImageType, type Wakeup } from '@weave-ai/shared';
import type { CoreServices } from '../api.js';
import { flattenWakes } from '../prompts/index.js';
import { sanitizeAttachmentFilename } from '../threads/attachmentStorage.js';

/** The per-agent directory the daemon writes readable attachments into; gitignored in a session home. */
export const ATTACHMENTS_DIR = '.weave-attachments';

/** The one place this path is computed, so the writer and `weave_inbox` always agree. */
export function attachmentFilePath(dir: string, attachment: { id: string; filename: string }): string {
  return join(dir, `${attachment.id}-${sanitizeAttachmentFilename(attachment.filename)}`);
}

/** Write (or overwrite) an attachment's bytes at its readable path and return that absolute path. */
export function writeAttachmentFile(dir: string, attachment: { id: string; filename: string }, bytes: Buffer): string {
  mkdirSync(dir, { recursive: true });
  const path = attachmentFilePath(dir, attachment);
  writeFileSync(path, bytes);
  return path;
}

/** The per-run directory readable attachments live under for an agent home. */
export function runAttachmentDir(homePath: string, runId: string): string {
  return join(homePath, ATTACHMENTS_DIR, runId);
}

export interface MaterializedAttachments {
  dir: string;
  /** Attachment id → the absolute path its bytes were written to. */
  paths: Record<string, string>;
}

/**
 * Write out every image attachment carried by this run's wakes and return the id→path map. A deleted
 * or unreadable attachment is skipped rather than failing the turn. Once anything was written, prior
 * runs' directories are pruned so the agent home does not grow without bound (an agent runs one turn
 * at a time, so no other run's files are still needed).
 */
export function materializeRunAttachments(
  deps: CoreServices,
  homePath: string,
  runId: string,
  wakes: Wakeup[],
): MaterializedAttachments {
  const dir = runAttachmentDir(homePath, runId);
  const paths: Record<string, string> = {};
  for (const w of flattenWakes(wakes)) {
    const threadId = typeof w.payload['threadId'] === 'string' ? w.payload['threadId'] : null;
    const ids = Array.isArray(w.payload['attachmentIds']) ? w.payload['attachmentIds'] : [];
    if (!threadId || ids.length === 0) continue;
    for (const id of ids) {
      if (typeof id !== 'string' || paths[id]) continue;
      let attachment: { id: string; filename: string; mediaType: string };
      let bytes: Buffer;
      try { ({ attachment, bytes } = deps.threads.attachment(threadId, id)); } catch { continue; }
      if (!isAttachmentImageType(attachment.mediaType)) continue;
      paths[id] = writeAttachmentFile(dir, attachment, bytes);
    }
  }
  if (Object.keys(paths).length > 0) pruneSiblingRunDirs(homePath, runId);
  return { dir, paths };
}

function pruneSiblingRunDirs(homePath: string, runId: string): void {
  const base = join(homePath, ATTACHMENTS_DIR);
  let entries;
  try { entries = readdirSync(base, { withFileTypes: true }); } catch { return; }
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name === runId) continue;
    try { rmSync(join(base, entry.name), { recursive: true, force: true }); } catch { /* best effort */ }
  }
}