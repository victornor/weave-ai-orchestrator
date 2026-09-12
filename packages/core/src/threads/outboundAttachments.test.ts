import { mkdirSync, mkdtempSync, rmSync, symlinkSync, truncateSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ATTACHMENT_MAX_OUTBOUND_FILE_BYTES } from '@weave-ai/shared';
import { assertAttachablePath, resolveOutboundAttachmentRoots, resolveOutboundAttachments } from './outboundAttachments.js';
import type { WorkspaceContext } from '../context.js';

let root: string;
let outside: string;
let ctx: WorkspaceContext;

/** Reads just the entry names out of a zip's central directory — enough to check for a zip-slip name. */
function zipEntryNames(zip: Buffer): string[] {
  const eocdSig = 0x06054b50;
  let eocdOffset = -1;
  for (let i = zip.length - 22; i >= 0; i--) {
    if (zip.readUInt32LE(i) === eocdSig) { eocdOffset = i; break; }
  }
  if (eocdOffset < 0) throw new Error('no end-of-central-directory record found');
  const total = zip.readUInt16LE(eocdOffset + 10);
  let p = zip.readUInt32LE(eocdOffset + 16);
  const names: string[] = [];
  for (let i = 0; i < total; i++) {
    const nameLen = zip.readUInt16LE(p + 28);
    const extraLen = zip.readUInt16LE(p + 30);
    const commentLen = zip.readUInt16LE(p + 32);
    names.push(zip.subarray(p + 46, p + 46 + nameLen).toString('utf8'));
    p += 46 + nameLen + extraLen + commentLen;
  }
  return names;
}

function write(rel: string, content = 'x'): string {
  const p = join(root, rel);
  mkdirSync(join(p, '..'), { recursive: true });
  writeFileSync(p, content);
  return p;
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'ac-ws-'));
  outside = mkdtempSync(join(tmpdir(), 'ac-outside-'));

  write('knowledge/PROJECT.md', 'project notes');
  write('knowledge/sub/notes.md', 'nested notes');
  write('projects/proj1/README.md', 'readme');
  write('projects/proj1/.git/config', '[remote "origin"]\n\turl = https://token@example.com/x.git\n');
  write('workers/w1/work/file.txt', 'worktree file');
  write('workers/w1/work/.git/HEAD', 'ref: refs/heads/main');
  mkdirSync(join(root, 'workers', 'w2'), { recursive: true }); // no work/ subdir
  write('archive/workers/w3/work/old.txt', 'retired worker file');
  write('.agent-conductor/secrets.enc', 'enc');
  write('.agent-conductor/secrets.key', 'key');
  write('.agent-conductor/db.sqlite', 'db');
  writeFileSync(join(outside, 'other.txt'), 'outside the workspace entirely');
  symlinkSync(join(outside, 'other.txt'), join(root, 'knowledge', 'escape.md'));

  ctx = {
    paths: {
      knowledge: join(root, 'knowledge'),
      projects: join(root, 'projects'),
      workers: join(root, 'workers'),
      archive: join(root, 'archive', 'workers'),
      state: join(root, '.agent-conductor'),
      secretsFile: join(root, '.agent-conductor', 'secrets.enc'),
      secretsKey: join(root, '.agent-conductor', 'secrets.key'),
      db: join(root, '.agent-conductor', 'db.sqlite'),
    },
  } as WorkspaceContext;
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(outside, { recursive: true, force: true });
});

describe('resolveOutboundAttachmentRoots', () => {
  it('includes knowledge, projects, and every worker/archive home that has a work/ subdirectory', () => {
    const roots = resolveOutboundAttachmentRoots(ctx);
    expect(roots).toContain(join(root, 'knowledge'));
    expect(roots).toContain(join(root, 'projects'));
    expect(roots).toContain(join(root, 'workers', 'w1', 'work'));
    expect(roots).toContain(join(root, 'archive', 'workers', 'w3', 'work'));
    // w2 has a home but no work/ subdirectory yet — never included, never the whole home either.
    expect(roots.some((r) => r.includes(join('workers', 'w2')))).toBe(false);
  });
});

describe('assertAttachablePath', () => {
  it('accepts a path inside the knowledge tree', () => {
    expect(assertAttachablePath(ctx, join(root, 'knowledge', 'PROJECT.md'))).toBe(join(root, 'knowledge', 'PROJECT.md'));
  });

  it('accepts a path inside a project clone', () => {
    expect(assertAttachablePath(ctx, join(root, 'projects', 'proj1', 'README.md'))).toBe(join(root, 'projects', 'proj1', 'README.md'));
  });

  it('accepts a path inside a worker worktree', () => {
    expect(assertAttachablePath(ctx, join(root, 'workers', 'w1', 'work', 'file.txt'))).toBe(join(root, 'workers', 'w1', 'work', 'file.txt'));
  });

  it('refuses a path outside every allowed root, naming it', () => {
    const p = join(outside, 'other.txt');
    expect(() => assertAttachablePath(ctx, p)).toThrow(new RegExp(p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  });

  it('refuses a symlink whose real target resolves outside the allowlist', () => {
    expect(() => assertAttachablePath(ctx, join(root, 'knowledge', 'escape.md'))).toThrow(/outside/);
  });

  it('refuses .git/config inside a project clone', () => {
    expect(() => assertAttachablePath(ctx, join(root, 'projects', 'proj1', '.git', 'config'))).toThrow(/\.git/);
  });

  it('refuses .git/HEAD inside a worker worktree', () => {
    expect(() => assertAttachablePath(ctx, join(root, 'workers', 'w1', 'work', '.git', 'HEAD'))).toThrow(/\.git/);
  });

  it('refuses the workspace secrets file', () => {
    expect(() => assertAttachablePath(ctx, ctx.paths.secretsFile)).toThrow(/outside/);
  });

  it('refuses the workspace secrets key', () => {
    expect(() => assertAttachablePath(ctx, ctx.paths.secretsKey)).toThrow(/outside/);
  });

  it('refuses the workspace database', () => {
    expect(() => assertAttachablePath(ctx, ctx.paths.db)).toThrow(/outside/);
  });

  it('refuses a directory', () => {
    expect(() => assertAttachablePath(ctx, join(root, 'knowledge', 'sub'))).toThrow(/not a regular file/);
  });

  it('refuses a path that does not exist, naming it', () => {
    const missing = join(root, 'knowledge', 'nope.md');
    expect(() => assertAttachablePath(ctx, missing)).toThrow(/does not exist/);
  });
});

describe('resolveOutboundAttachments', () => {
  it('resolves a single-file entry with its original filename and a guessed media type', () => {
    const [result] = resolveOutboundAttachments(ctx, [{ path: join(root, 'knowledge', 'PROJECT.md') }]);
    expect(result!.filename).toBe('PROJECT.md');
    expect(result!.mediaType).toBe('text/markdown');
    expect(result!.bytes.toString('utf8')).toBe('project notes');
  });

  it('falls back to application/octet-stream for an unrecognized extension', () => {
    write('knowledge/data.bin', 'binary-ish');
    const [result] = resolveOutboundAttachments(ctx, [{ path: join(root, 'knowledge', 'data.bin') }]);
    expect(result!.mediaType).toBe('application/octet-stream');
  });

  it('bundles several paths into one zip, defaulting its name to something identifying', () => {
    const [result] = resolveOutboundAttachments(ctx, [{
      paths: [join(root, 'knowledge', 'PROJECT.md'), join(root, 'projects', 'proj1', 'README.md')],
    }]);
    expect(result!.mediaType).toBe('application/zip');
    expect(result!.filename).toMatch(/^weaver-attachments-.*\.zip$/);
    expect(result!.bytes.subarray(0, 4)).toEqual(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
  });

  it('sanitizes a supplied zip name and appends .zip if missing', () => {
    const [result] = resolveOutboundAttachments(ctx, [{
      paths: [join(root, 'knowledge', 'PROJECT.md'), join(root, 'projects', 'proj1', 'README.md')],
      zipName: 'design-handoff',
    }]);
    expect(result!.filename).toBe('design-handoff.zip');
  });

  it('fails the whole request when one path in a zip bundle is disallowed — no partial zip', () => {
    expect(() => resolveOutboundAttachments(ctx, [{
      paths: [join(root, 'knowledge', 'PROJECT.md'), join(root, 'projects', 'proj1', '.git', 'config'), join(root, 'projects', 'proj1', 'README.md')],
    }])).toThrow(/\.git/);
    // The same two valid paths, without the bad one, succeed and contain exactly those two files —
    // proving the failing call above produced nothing at all, not a zip silently missing an entry.
    const [ok] = resolveOutboundAttachments(ctx, [{
      paths: [join(root, 'knowledge', 'PROJECT.md'), join(root, 'projects', 'proj1', 'README.md')],
    }]);
    expect(ok!.bytes.length).toBeGreaterThan(0);
  });

  it('fails a message-level request when one entry among several is bad', () => {
    expect(() => resolveOutboundAttachments(ctx, [
      { path: join(root, 'knowledge', 'PROJECT.md') },
      { path: join(outside, 'other.txt') },
    ])).toThrow(/outside/);
  });

  it('refuses a single file over the outbound size cap, naming it', () => {
    const big = join(root, 'knowledge', 'big.bin');
    writeFileSync(big, '');
    truncateSync(big, ATTACHMENT_MAX_OUTBOUND_FILE_BYTES + 1);
    expect(() => resolveOutboundAttachments(ctx, [{ path: big }])).toThrow(/exceeds the .* byte/);
  });

  it('names zip entries from the resolved path, never the raw one — closing a zip-slip via a `..` segment plus a basename collision (plan-review fix)', () => {
    write('knowledge/a/notes.md', 'from a');
    write('knowledge/b/notes.md', 'from b');
    // Raw path contains a `..` segment; `basename(dirname(rawPath))` would be `..` if a collision
    // handler ever looked at the raw path instead of its realpath-resolved form.
    const trickyRawPath = join(root, 'knowledge', 'b', 'sub', '..', 'notes.md');

    const [result] = resolveOutboundAttachments(ctx, [{
      paths: [join(root, 'knowledge', 'a', 'notes.md'), trickyRawPath],
    }]);

    const names = zipEntryNames(result!.bytes);
    expect(names).toHaveLength(2);
    for (const name of names) {
      expect(name).not.toContain('..');
      expect(name.startsWith('/')).toBe(false);
    }
    expect(names).toEqual(['notes.md', 'b/notes.md']); // parent-prefixed from the real directory, not the raw path
  });

  it('refuses a zip bundle whose combined input exceeds the zip cap', () => {
    const big = join(root, 'knowledge', 'big.bin');
    writeFileSync(big, '');
    truncateSync(big, ATTACHMENT_MAX_OUTBOUND_FILE_BYTES); // under the per-file cap
    const paths = Array.from({ length: 5 }, () => big); // 5x the per-file cap, over the zip cap
    expect(() => resolveOutboundAttachments(ctx, [{ paths }])).toThrow(/combined input/);
  });
});
