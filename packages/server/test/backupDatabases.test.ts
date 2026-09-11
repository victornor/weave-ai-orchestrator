/**
 * VS-258: `backupDatabases()` used to rebuild a workspace's db path as a hardcoded
 * `.agent-conductor/db.sqlite` literal, so a workspace resolved to the new name was silently
 * skipped by `if (!existsSync(src)) continue;` — no error, no entry in the returned list. It now
 * resolves through `resolveWorkspaceStateDir()`, so the existence check downstream is always
 * checking the right path, and an ambiguous workspace fails loudly instead.
 */
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import YAML from 'yaml';
import { backupDatabases } from '../src/upgrade.js';

const tmps: string[] = [];
afterEach(() => { while (tmps.length) rmSync(tmps.pop()!, { recursive: true, force: true }); });
function tmp(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tmps.push(dir);
  return dir;
}

function setup(): { configDir: string; registerWorkspace: (id: string, root: string) => void } {
  const configDir = tmp('ac-backup-cfg-');
  writeFileSync(join(configDir, 'daemon.sqlite'), 'daemon-db');
  const workspaces: Array<{ id: string; path: string }> = [];
  writeFileSync(join(configDir, 'workspaces.yaml'), YAML.stringify({ workspaces }), 'utf8');
  return {
    configDir,
    registerWorkspace(id, root) {
      workspaces.push({ id, path: root });
      writeFileSync(join(configDir, 'workspaces.yaml'), YAML.stringify({ workspaces }), 'utf8');
    },
  };
}

describe('backupDatabases (VS-258)', () => {
  it('backs up a workspace resolved to the old name', () => {
    const { configDir, registerWorkspace } = setup();
    const root = tmp('ac-backup-old-');
    mkdirSync(join(root, '.agent-conductor'));
    writeFileSync(join(root, '.agent-conductor', 'db.sqlite'), 'old-db');
    registerWorkspace('ws1', root);

    const out = backupDatabases(configDir);
    expect(out.some((p) => p.endsWith('workspace-ws1.sqlite'))).toBe(true);
  });

  it('backs up a workspace resolved to the new name — the bug this fixes: it used to be silently skipped', () => {
    const { configDir, registerWorkspace } = setup();
    const root = tmp('ac-backup-new-');
    mkdirSync(join(root, '.weave'));
    writeFileSync(join(root, '.weave', 'db.sqlite'), 'new-db');
    registerWorkspace('ws1', root);

    const out = backupDatabases(configDir);
    expect(out.some((p) => p.endsWith('workspace-ws1.sqlite'))).toBe(true);
  });

  it('throws for an ambiguous workspace rather than silently skipping it or backing up the wrong side', () => {
    const { configDir, registerWorkspace } = setup();
    const root = tmp('ac-backup-ambiguous-');
    mkdirSync(join(root, '.agent-conductor'));
    mkdirSync(join(root, '.weave'));
    writeFileSync(join(root, '.agent-conductor', 'db.sqlite'), 'old-db');
    writeFileSync(join(root, '.weave', 'db.sqlite'), 'new-db');
    registerWorkspace('ws1', root);

    expect(() => backupDatabases(configDir)).toThrow(/ambiguous workspace install/);
    // Nothing was written for this run — no partial, silently-wrong backup.
    expect(readdirSync(configDir)).not.toContain('backups');
  });

  it('a workspace that has never booted (no db.sqlite under either name) is simply not backed up, not an error', () => {
    const { configDir, registerWorkspace } = setup();
    const root = tmp('ac-backup-unbooted-');
    registerWorkspace('ws1', root);

    const out = backupDatabases(configDir);
    expect(out.some((p) => p.includes('ws1'))).toBe(false);
    expect(out.some((p) => p.endsWith('daemon.sqlite'))).toBe(true);
  });
});
