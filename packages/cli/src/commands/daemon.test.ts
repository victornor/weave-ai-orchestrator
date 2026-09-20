/**
 * VS-258: this file's `backupDatabases()` is an independent copy of `packages/server/src/upgrade.ts`'s
 * (this ticket fixes the path literal in each, not the pre-existing duplication between them). Same
 * bug, same fix: it used to rebuild a workspace's db path as a hardcoded `.agent-conductor/db.sqlite`
 * literal, silently skipping a workspace resolved to the new name.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import YAML from 'yaml';
import { configureOutput } from '../output.js';
import { buildProgram } from '../program.js';
import { backupDatabases } from './daemon.js';

const tmps: string[] = [];
const savedEnv = { ...process.env };

beforeEach(() => {
  delete process.env['AC_CONFIG_HOME'];
});
afterEach(() => {
  while (tmps.length) rmSync(tmps.pop()!, { recursive: true, force: true });
  if (savedEnv['AC_CONFIG_HOME'] === undefined) delete process.env['AC_CONFIG_HOME'];
  else process.env['AC_CONFIG_HOME'] = savedEnv['AC_CONFIG_HOME'];
});

function tmp(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tmps.push(dir);
  return dir;
}

function setup(): { registerWorkspace: (id: string, root: string) => void } {
  const configDir = tmp('ac-clibackup-cfg-');
  process.env['AC_CONFIG_HOME'] = configDir;
  writeFileSync(join(configDir, 'daemon.sqlite'), 'daemon-db');
  const workspaces: Array<{ id: string; path: string }> = [];
  const write = () => writeFileSync(join(configDir, 'workspaces.yaml'), YAML.stringify({ workspaces }), 'utf8');
  write();
  return { registerWorkspace: (id, root) => { workspaces.push({ id, path: root }); write(); } };
}

describe('backupDatabases (cli copy, VS-258)', () => {
  it('backs up a workspace resolved to the new name — the bug this fixes: it used to be silently skipped', () => {
    const { registerWorkspace } = setup();
    const root = tmp('ac-clibackup-new-');
    mkdirSync(join(root, '.weave'));
    writeFileSync(join(root, '.weave', 'db.sqlite'), 'new-db');
    registerWorkspace('ws1', root);

    const out = backupDatabases();
    expect(out.some((p) => p.includes('workspace-ws1'))).toBe(true);
  });

  it('throws for an ambiguous workspace rather than silently skipping it', () => {
    const { registerWorkspace } = setup();
    const root = tmp('ac-clibackup-ambiguous-');
    mkdirSync(join(root, '.agent-conductor'));
    mkdirSync(join(root, '.weave'));
    writeFileSync(join(root, '.agent-conductor', 'db.sqlite'), 'old-db');
    writeFileSync(join(root, '.weave', 'db.sqlite'), 'new-db');
    registerWorkspace('ws1', root);

    expect(() => backupDatabases()).toThrow(/ambiguous workspace install/);
  });
});

describe('daemon write-shims (VS-631)', () => {
  const saved = { HOME: process.env['HOME'], XDG_DATA_HOME: process.env['XDG_DATA_HOME'] };
  afterEach(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  });

  it('writes this release\'s weave and weave-agent shims, the entry the new release\'s own writer runs', async () => {
    const home = tmp('vs631-home-');
    const data = tmp('vs631-data-');
    process.env['HOME'] = home;
    process.env['XDG_DATA_HOME'] = data;
    const dist = join(data, 'weave', 'current', 'packages', 'cli', 'dist');
    mkdirSync(dist, { recursive: true });
    writeFileSync(join(dist, 'bin.js'), '// cli\n');
    writeFileSync(join(dist, 'repl-bin.js'), '// repl\n');

    let out = '';
    const spy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => { out += String(chunk); return true; });
    try {
      await buildProgram().parseAsync(['node', 'conductor', 'daemon', 'write-shims'], { from: 'node' });
    } finally {
      spy.mockRestore();
      configureOutput({ json: false });
    }

    const agent = join(home, '.local', 'bin', 'weave-agent');
    expect(existsSync(join(home, '.local', 'bin', 'weave'))).toBe(true);
    expect(existsSync(agent)).toBe(true);
    expect(readFileSync(agent, 'utf8')).toContain('repl-bin.js');
    expect(out).toContain('shim');
  });
});
