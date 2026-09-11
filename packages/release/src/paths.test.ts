import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { resolveInstallPath, resolveWorkspaceStateDir } from './paths.js';

const tmps: string[] = [];
afterEach(() => { while (tmps.length) rmSync(tmps.pop()!, { recursive: true, force: true }); });

function tmp(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tmps.push(dir);
  return dir;
}

describe('resolveInstallPath', () => {
  it('resolves to the old path when only it exists', () => {
    const base = tmp('ac-paths-old-');
    const oldPath = join(base, 'agent-conductor');
    mkdirSync(oldPath);
    expect(resolveInstallPath(oldPath, join(base, 'weave'))).toEqual({ status: 'old', path: oldPath });
  });

  it('resolves to the new path when only it exists', () => {
    const base = tmp('ac-paths-new-');
    const newPath = join(base, 'weave');
    mkdirSync(newPath);
    expect(resolveInstallPath(join(base, 'agent-conductor'), newPath)).toEqual({ status: 'new', path: newPath });
  });

  it('resolves to the new path (fresh install) when neither exists', () => {
    const base = tmp('ac-paths-fresh-');
    const newPath = join(base, 'weave');
    expect(resolveInstallPath(join(base, 'agent-conductor'), newPath)).toEqual({ status: 'fresh', path: newPath });
  });

  it('refuses when both exist, naming both paths', () => {
    const base = tmp('ac-paths-ambiguous-');
    const oldPath = join(base, 'agent-conductor');
    const newPath = join(base, 'weave');
    mkdirSync(oldPath);
    mkdirSync(newPath);
    expect(resolveInstallPath(oldPath, newPath)).toEqual({ status: 'ambiguous', oldPath, newPath });
  });
});

describe('resolveWorkspaceStateDir', () => {
  it('finds an existing workspace under the old name, keyed on db.sqlite (not directory presence)', () => {
    const root = tmp('ac-ws-old-');
    // The directory exists (as ensureLayout would create it), but no db.sqlite yet: still fresh.
    mkdirSync(join(root, '.agent-conductor'));
    expect(resolveWorkspaceStateDir(root)).toEqual({ status: 'fresh', stateDir: join(root, '.weave') });

    writeFileSync(join(root, '.agent-conductor', 'db.sqlite'), '');
    expect(resolveWorkspaceStateDir(root)).toEqual({ status: 'old', stateDir: join(root, '.agent-conductor') });
  });

  it('finds an existing workspace under the new name', () => {
    const root = tmp('ac-ws-new-');
    mkdirSync(join(root, '.weave'));
    writeFileSync(join(root, '.weave', 'db.sqlite'), '');
    expect(resolveWorkspaceStateDir(root)).toEqual({ status: 'new', stateDir: join(root, '.weave') });
  });

  it('gives a fresh workspace the new name', () => {
    const root = tmp('ac-ws-fresh-');
    expect(resolveWorkspaceStateDir(root)).toEqual({ status: 'fresh', stateDir: join(root, '.weave') });
  });

  it('throws naming both paths when a db.sqlite exists under both names', () => {
    const root = tmp('ac-ws-ambiguous-');
    mkdirSync(join(root, '.agent-conductor'));
    mkdirSync(join(root, '.weave'));
    writeFileSync(join(root, '.agent-conductor', 'db.sqlite'), '');
    writeFileSync(join(root, '.weave', 'db.sqlite'), '');
    expect(() => resolveWorkspaceStateDir(root)).toThrow(
      `ambiguous workspace install at ${root}: both ${join(root, '.agent-conductor', 'db.sqlite')} and ${join(root, '.weave', 'db.sqlite')} exist`,
    );
  });
});
