import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import YAML from 'yaml';
import { DaemonConfigSchema, type WorkspaceConfig } from '@agent-conductor/shared';
import { createRegistries } from '../context.js';
import { loader } from './loader.js';

describe('workspace loader', () => {
  let root: string;
  let cfgDir: string;
  const previousXdg = process.env.XDG_CONFIG_HOME;
  const opened: Array<{ close: () => void }> = [];

  const load = async (dir = root) => {
    const ctx = await loader.loadWorkspace(dir, {
      daemon: DaemonConfigSchema.parse({}), registries: createRegistries(),
      loopbackUrl: 'http://127.0.0.1:7433', skillsDir: join(dir, 'skills'), templatesDir: join(dir, 'templates'),
    });
    opened.push(ctx.db);
    return ctx;
  };

  beforeEach(() => {
    root = join(mkdtempSync(join(tmpdir(), 'ac-ws-')), 'acme');
    cfgDir = mkdtempSync(join(tmpdir(), 'ac-cfg-'));
    process.env.XDG_CONFIG_HOME = cfgDir;
  });
  afterEach(() => {
    while (opened.length) { try { opened.pop()!.close(); } catch { /* already closed */ } }
    if (previousXdg === undefined) delete process.env.XDG_CONFIG_HOME; else process.env.XDG_CONFIG_HOME = previousXdg;
    rmSync(root, { recursive: true, force: true });
    rmSync(cfgDir, { recursive: true, force: true });
  });

  it('scaffolds the §5 layout and the knowledge skeletons', async () => {
    const config = await loader.initWorkspace(root, { id: 'acme', name: 'Acme Labs', ticketPrefix: 'ACME' });
    expect(config.ticketPrefix).toBe('ACME');
    for (const rel of [
      'workspace.yaml', '.agent-conductor', '.agent-conductor/runs', '.agent-conductor/runtimes', '.agent-conductor/wt.toml',
      'conductor', 'roles', 'workers', 'archive/workers', 'projects',
      'knowledge/workspace/WORKSPACE.md', 'knowledge/workspace/SHARED.md', 'knowledge/workspace/decisions.md', 'knowledge/projects',
    ]) expect(existsSync(join(root, rel)), rel).toBe(true);
    expect(readFileSync(join(root, 'knowledge/workspace/SHARED.md'), 'utf8')).toContain('Shared conventions');
    expect(readFileSync(join(root, '.agent-conductor/wt.toml'), 'utf8')).toContain('json-schema = 2');
    await expect(loader.initWorkspace(root, { id: 'acme', name: 'Acme', ticketPrefix: 'ACME' })).rejects.toMatchObject({ code: 'conflict' });
  });

  it('loads the workspace, opens the db, registers providers and creates runtime homes', async () => {
    await loader.initWorkspace(root, { id: 'acme', name: 'Acme Labs', ticketPrefix: 'ACME' });
    const ctx = await load();
    expect(ctx.config.id).toBe('acme');
    expect(ctx.workspaceId).toBeTruthy();
    expect(ctx.db.get<{ slug: string }>('SELECT slug FROM workspaces')!.slug).toBe('acme');
    expect([...ctx.registries.worktreeProviders.keys()].sort()).toEqual(['git', 'worktrunk']);
    expect(ctx.registries.forges.has('github')).toBe(true);
    expect(existsSync(join(root, '.agent-conductor/runtimes/claude'))).toBe(true);
    expect(ctx.paths.db).toBe(join(root, '.agent-conductor', 'db.sqlite'));

    // Loading again reuses the same workspace row.
    const again = await load();
    expect(again.workspaceId).toBe(ctx.workspaceId);
  });

  it('resolves ${ENV} references and writes them back unresolved', async () => {
    await loader.initWorkspace(root, { id: 'acme', name: 'Acme Labs', ticketPrefix: 'ACME' });
    const file = join(root, 'workspace.yaml');
    const raw = YAML.parse(readFileSync(file, 'utf8')) as WorkspaceConfig;
    raw.channels = { telegram: { botToken: '${AC_TEST_TG_TOKEN}' } };
    writeFileSync(file, YAML.stringify(raw), 'utf8');
    process.env.AC_TEST_TG_TOKEN = 'secret-token-value';

    const ctx = await load();
    expect((ctx.config.channels.telegram as { botToken: string }).botToken).toBe('secret-token-value');

    await ctx.saveConfig({ ...ctx.config, name: 'Acme Labs Renamed' });
    const written = readFileSync(file, 'utf8');
    expect(written).toContain('${AC_TEST_TG_TOKEN}');
    expect(written).not.toContain('secret-token-value');
    expect(written).toContain('Acme Labs Renamed');
    delete process.env.AC_TEST_TG_TOKEN;
  });

  it('rejects an invalid workspace.yaml and a missing one', async () => {
    await expect(load(root)).rejects.toMatchObject({ code: 'not_found' });
    await loader.initWorkspace(root, { id: 'acme', name: 'Acme Labs', ticketPrefix: 'ACME' });
    writeFileSync(join(root, 'workspace.yaml'), 'version: 1\nid: Acme Labs\n', 'utf8');
    await expect(load(root)).rejects.toMatchObject({ code: 'validation' });
  });

  it('regenerates wt.toml from the declared projects on save', async () => {
    await loader.initWorkspace(root, { id: 'acme', name: 'Acme Labs', ticketPrefix: 'ACME' });
    const ctx = await load();
    await ctx.saveConfig({
      ...ctx.config,
      projects: [{ id: 'api', url: 'git@github.com:acme/api.git', defaultBranch: 'main', maxWorkers: 4, warmPaths: [], setupCommand: 'pnpm install', openspec: { enabled: true }, policies: {} }],
    });
    const toml = readFileSync(join(root, '.agent-conductor/wt.toml'), 'utf8');
    expect(toml).toContain('[projects."github.com/acme/api"]');
    expect(toml).toContain('setup = "pnpm install"');
  });

  it('reads and writes the daemon registry and config under XDG_CONFIG_HOME', () => {
    expect(loader.configDir()).toBe(join(cfgDir, 'agent-conductor'));
    expect(loader.readRegistry().workspaces).toEqual([]);
    loader.writeRegistry({ workspaces: [{ id: 'acme', path: root }] });
    expect(loader.readRegistry().workspaces).toEqual([{ id: 'acme', path: root }]);

    const daemon = loader.readDaemonConfig();
    expect(daemon.http.listen).toBe('127.0.0.1:7433');
    loader.writeDaemonConfig({ ...daemon, logLevel: 'debug' });
    expect(loader.readDaemonConfig().logLevel).toBe('debug');
  });
});
