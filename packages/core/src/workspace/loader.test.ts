import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import YAML from 'yaml';
import { DaemonConfigSchema, type WorkspaceConfig } from '@agent-conductor/shared';
import { createRegistries } from '../context.js';
import { openDbAsOf } from '@agent-conductor/db';
import { loader, projectKnowledgeSkeleton } from './loader.js';

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

  it('gives a fresh workspace the default knowledge budgets and states them in the skeletons', async () => {
    const config = await loader.initWorkspace(root, { id: 'acme', name: 'Acme Labs', ticketPrefix: 'ACME' });
    expect(config.defaults.knowledgeBudgetTokens).toEqual({ workspace: 10000, shared: 2000, decisions: 4000, project: 10000, document: 10000 });
    expect(config.defaults.bootstrapBudgetTokens).toBe(16000);
    expect(readFileSync(join(root, 'knowledge/workspace/WORKSPACE.md'), 'utf8')).toContain('Budget 10000 tokens');
    expect(readFileSync(join(root, 'knowledge/workspace/SHARED.md'), 'utf8')).toContain('Budget 2000 tokens');
    expect(readFileSync(join(root, 'knowledge/workspace/decisions.md'), 'utf8')).toContain('Budget 4000 tokens');
    expect(projectKnowledgeSkeleton('api', config.defaults.knowledgeBudgetTokens.project)).toContain('Budget 10000 tokens');
  });

  it('keeps an explicitly configured knowledge budget and defaults the rest', async () => {
    await loader.initWorkspace(root, { id: 'acme', name: 'Acme Labs', ticketPrefix: 'ACME' });
    const file = join(root, 'workspace.yaml');
    const raw = YAML.parse(readFileSync(file, 'utf8')) as WorkspaceConfig;
    writeFileSync(file, YAML.stringify({ ...raw, defaults: { ...raw.defaults, knowledgeBudgetTokens: { project: 25000 } } }), 'utf8');

    const ctx = await load();
    expect(ctx.config.defaults.knowledgeBudgetTokens.project).toBe(25000);
    expect(ctx.config.defaults.knowledgeBudgetTokens.document).toBe(10000);
    expect(ctx.config.defaults.knowledgeBudgetTokens.shared).toBe(2000);
  });

  it('rejects a knowledge budget that is not a sane token count', async () => {
    await loader.initWorkspace(root, { id: 'acme', name: 'Acme Labs', ticketPrefix: 'ACME' });
    const file = join(root, 'workspace.yaml');
    const raw = YAML.parse(readFileSync(file, 'utf8')) as WorkspaceConfig;
    writeFileSync(file, YAML.stringify({ ...raw, defaults: { ...raw.defaults, knowledgeBudgetTokens: { project: 0 } } }), 'utf8');
    await expect(load(root)).rejects.toMatchObject({ code: 'validation' });
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

  // VS-77: a workspace written under the layered scheme is migrated on load, once, using the roles
  // the database still holds — migration 0012 stashes them before it drops the columns.
  describe('migrating onto the two model settings', () => {
    /** A workspace.yaml as it looked before this change, plus the roles it had hired. */
    async function legacy(over: Record<string, unknown>, roles: Array<{ id: string; runtime: string; model?: string | null; effort?: string | null }> = []): Promise<void> {
      await loader.initWorkspace(root, { id: 'acme', name: 'Acme Labs', ticketPrefix: 'ACME' });
      const file = join(root, 'workspace.yaml');
      const raw = YAML.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
      delete raw['models'];
      writeFileSync(file, YAML.stringify({ ...raw, ...over }), 'utf8');
      if (!roles.length) return;

      // Seed the rows on the schema as it stood before 0012, then let the load migrate both.
      const db = openDbAsOf(join(root, '.agent-conductor', 'db.sqlite'), '0011_agent_pause_detail.sql');
      db.run(`INSERT INTO workspaces (id, slug, name, ticket_prefix, ticket_counter, status, root_path, created_at, updated_at)
              VALUES ('ws1', 'acme', 'Acme Labs', 'ACME', 1, 'active', ?, 't0', 't0')`, [root]);
      db.run(`INSERT INTO projects (id, workspace_id, slug, name, git_url, clone_path, runtime_id, created_at, updated_at)
              VALUES ('p1', 'ws1', 'api', 'API', 'git@x:a/api.git', '/tmp/api', 'claude', 't0', 't0')`);
      for (const r of roles) {
        db.run(`INSERT INTO roles (id, workspace_id, project_id, slug, name, charter_summary, scope_text, runtime_id, model, effort, status, created_at, updated_at)
                VALUES (?, 'ws1', 'p1', ?, ?, 'Owns it', 'The api repo', ?, ?, ?, 'active', 't0', 't0')`,
          [r.id, r.id, r.id, r.runtime, r.model ?? null, r.effort ?? null]);
      }
      db.close();
    }

    const yamlOf = (): Record<string, unknown> => YAML.parse(readFileSync(join(root, 'workspace.yaml'), 'utf8')) as Record<string, unknown>;

    it('derives both settings from what the workspace was running on, and drops the keys they replace', async () => {
      await legacy(
        { defaults: { runtime: 'claude', model: null }, conductor: { runtime: 'claude', model: 'claude-fable-5-1', channels: ['web'] } },
        [{ id: 'backend', runtime: 'codex', model: 'gpt-5' }, { id: 'docs', runtime: 'codex', model: 'gpt-5' }],
      );

      const ctx = await load();
      expect(ctx.config.models).toEqual({
        conductor: { runtime: 'claude', model: 'claude-fable-5-1' },
        workers: { runtime: 'codex', model: 'gpt-5' },
      });

      // Written back, and the layered keys are gone from the file for good.
      const written = yamlOf();
      expect(written['models']).toEqual(ctx.config.models);
      expect(written['defaults']).not.toHaveProperty('runtime');
      expect(written['defaults']).not.toHaveProperty('model');
      expect(written['conductor']).not.toHaveProperty('runtime');
      expect(written['conductor']).not.toHaveProperty('model');
      expect((written['conductor'] as Record<string, unknown>)['channels']).toEqual(['web']);
    });

    it('takes the workspace default when no role was ever hired', async () => {
      await legacy({ defaults: { runtime: 'gemini', model: 'flash' } });
      expect((await load()).config.models.workers).toEqual({ runtime: 'gemini', model: 'flash' });
    });

    it('runs once: a second load rewrites nothing', async () => {
      await legacy({ defaults: { runtime: 'codex', model: 'gpt-5' } });
      await load();
      const afterFirst = readFileSync(join(root, 'workspace.yaml'), 'utf8');
      const ctx = await load();
      expect(readFileSync(join(root, 'workspace.yaml'), 'utf8')).toBe(afterFirst);
      expect(ctx.config.models.workers).toEqual({ runtime: 'codex', model: 'gpt-5' });
    });

    it('leaves a workspace that already names its models alone', async () => {
      await loader.initWorkspace(root, { id: 'acme', name: 'Acme Labs', ticketPrefix: 'ACME' });
      const file = join(root, 'workspace.yaml');
      const raw = YAML.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
      writeFileSync(file, YAML.stringify({ ...raw, defaults: { ...(raw['defaults'] as object), runtime: 'codex' }, models: { conductor: { runtime: 'opencode', model: 'grok' }, workers: { runtime: 'gemini', model: null } } }), 'utf8');

      const ctx = await load();
      expect(ctx.config.models).toEqual({ conductor: { runtime: 'opencode', model: 'grok' }, workers: { runtime: 'gemini', model: null } });
    });

    it('writes the most used runtime and leaves the question open when the roles disagreed', async () => {
      await legacy({}, [
        { id: 'backend', runtime: 'codex' },
        { id: 'docs', runtime: 'codex' },
        { id: 'infra', runtime: 'claude' },
      ]);

      const ctx = await load();
      expect(ctx.config.models.workers.runtime).toBe('codex');
      const settings = ctx.db.get<{ settings: Record<string, unknown> }>('SELECT settings_json FROM workspaces WHERE id = ?', [ctx.workspaceId])!.settings;
      expect(settings['modelsMigration']).toMatchObject({
        ambiguous: true, chosen: 'codex',
        counts: [{ runtime: 'codex', roles: 2 }, { runtime: 'claude', roles: 1 }],
      });
    });

    it('records nothing to ask about when every role agreed', async () => {
      await legacy({}, [{ id: 'backend', runtime: 'codex' }, { id: 'docs', runtime: 'codex' }]);
      const ctx = await load();
      const settings = ctx.db.get<{ settings: Record<string, unknown> }>('SELECT settings_json FROM workspaces WHERE id = ?', [ctx.workspaceId])!.settings;
      expect(settings['modelsMigration']).toBeUndefined();
    });
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
