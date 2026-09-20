/**
 * `write` (runtime-details section 5, VS-608): create or overwrite a file through a temporary file
 * in the same directory, preserving an existing file's mode, with the prior-read rule and the 10 MB
 * refusal.
 */
import { randomBytes } from 'node:crypto';
import { closeSync, existsSync, fchmodSync, fsyncSync, openSync, readFileSync, renameSync, statSync, unlinkSync, writeSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { confinePath } from './confine.js';
import { errorOutput, type ToolDefinition } from './index.js';

export const WRITE_MAX_BYTES = 10 * 1024 * 1024;

/** Write `bytes` to `path` atomically: temp file, flush, rename; the temp file is unlinked on failure. */
export function atomicWrite(path: string, bytes: Buffer): void {
  const tmp = join(dirname(path), `.${basename(path)}.${randomBytes(6).toString('hex')}.tmp`);
  let mode: number | undefined;
  try { mode = statSync(path).mode & 0o777; } catch { /* new file: default mode */ }
  let fd: number | undefined;
  try {
    fd = openSync(tmp, 'w', mode ?? 0o644);
    if (mode !== undefined) fchmodSync(fd, mode);
    writeSync(fd, bytes);
    fsyncSync(fd);
    closeSync(fd);
    fd = undefined;
    renameSync(tmp, path);
  } catch (e) {
    if (fd !== undefined) { try { closeSync(fd); } catch { /* already closed */ } }
    try { unlinkSync(tmp); } catch { /* never created */ }
    throw e;
  }
}

export const lineCount = (text: string): number => (text === '' ? 0 : text.split('\n').length);

export const writeTool: ToolDefinition = {
  name: 'write',
  description: 'Create a file, or overwrite one that was read this turn. The write is atomic. Refuses files over 10 MB.',
  parameters: {
    type: 'object', additionalProperties: false, required: ['path', 'content'],
    properties: {
      path: { type: 'string' },
      content: { type: 'string' },
    },
  },
  async run(args, ctx) {
    const rawPath = args['path'];
    const content = args['content'];
    if (typeof rawPath !== 'string' || !rawPath) return errorOutput('path is required');
    if (typeof content !== 'string') return errorOutput('content is required');
    const bytes = Buffer.from(content, 'utf8');
    if (bytes.length > WRITE_MAX_BYTES) return errorOutput(`refusing to write ${bytes.length} bytes (over 10 MB); use bash`);

    const confined = confinePath(rawPath, 'write', ctx);
    if (!confined.ok) return errorOutput(confined.error);
    const path = confined.path;
    const existed = existsSync(path);
    let previous = '';
    if (existed) {
      const check = ctx.ledger.check(path);
      if (check === 'missing') return errorOutput(`file must be read before it is overwritten: ${path}`);
      if (check === 'stale') return errorOutput('file changed since it was read; read it again');
      try { previous = readFileSync(path, 'utf8'); } catch { previous = ''; }
    }
    try { atomicWrite(path, bytes); } catch (e) { return errorOutput(`could not write ${path}: ${(e as Error).message}`); }
    ctx.ledger.refresh(path, bytes);
    ctx.emit('file.changed', { path, changeType: existed ? 'modified' : 'created', additions: lineCount(content), deletions: existed ? lineCount(previous) : 0 });
    return { text: `${existed ? 'Overwrote' : 'Created'} ${path} (${bytes.length} bytes)` };
  },
};