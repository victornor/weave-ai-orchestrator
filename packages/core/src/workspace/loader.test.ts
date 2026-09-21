import { existsSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import YAML from 'yaml';
import { DaemonConfigSchema, WorkspaceConfigSchema, toLegacySpelling, type WorkspaceConfig } from '@weave-ai/shared';
import { createRegistries, workspacePaths } from '../context.js';
import { openDbAsOf, newId, nowIso } from '@weave-ai/db';
import { createSecretStore } from '../secrets/store.js';
import { effectiveModels } from '../models/index.js';
import { loader, projectKnowledgeSkeleton } from './loader.js';

describe('workspace loader', () => {
  let root: string;
  let cfgDir: string;
  const previousXdg = process.env.XDG_CONFIG_HOME;
  const opened: Array<{ close: () => void }> = [];

  const load = async (dir = root) => {
    const ctx = await loader.loadWorkspace(dir, {
      daemon: DaemonConfigSchema.parse({}), registries: createRegistries(),
      loopbackUrl: 'http://127.0.0.1:7433', skillsDir: join(dir, 'skills'), templatesDir: join(dir, 'templates'), v2ThemeCss: '',
      daemonConfigDir: cfgDir, isolated: false,
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
    // VS-258: a fresh workspace (nothing on disk under either name) lands on the new names.
    for (const rel of [
      'workspace.yaml', '.weave', '.weave/runs', '.weave/runtimes', '.weave/wt.toml',
      'weaver', 'roles', 'workers', 'archive/workers', 'projects',
      'knowledge/workspace/WORKSPACE.md', 'knowledge/workspace/SHARED.md', 'knowledge/workspace/decisions.md', 'knowledge/projects',
    ]) expect(existsSync(join(root, rel)), rel).toBe(true);
    expect(readFileSync(join(root, 'knowledge/workspace/SHARED.md'), 'utf8')).toContain('Shared conventions');
    expect(readFileSync(join(root, '.weave/wt.toml'), 'utf8')).toContain('json-schema = 2');
    // VS-258: the state directory's .gitignore is written through workspacePaths(), not a hardcoded literal.
    expect(readFileSync(join(root, '.weave/.gitignore'), 'utf8')).toBe('*\n');
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
    // VS-258: a fresh workspace lands on the new name.
    expect(existsSync(join(root, '.weave/runtimes/claude'))).toBe(true);
    expect(ctx.paths.db).toBe(join(root, '.weave', 'db.sqlite'));

    // Loading again reuses the same workspace row.
    const again = await load();
    expect(again.workspaceId).toBe(ctx.workspaceId);
  });

  it('an existing installation under the old name loads byte-identically to before this change, and no .weave/weaver reappears (VS-258, acceptance criterion 2)', async () => {
    await loader.initWorkspace(root, { id: 'acme', name: 'Acme Labs', ticketPrefix: 'ACME' });
    const first = await load();
    const workspaceId = first.workspaceId;
    first.db.close(); // afterEach tolerates the double-close of an already-closed db

    // Simulate what every workspace running today actually looks like: rename the fresh install's
    // new-named directories to the old ones, exactly as if this workspace had always been on the old
    // name (nothing in this change ever performs this rename itself — see design.md's Migration Plan).
    renameSync(join(root, '.weave'), join(root, '.agent-conductor'));
    renameSync(join(root, 'weaver'), join(root, 'conductor'));

    const ctx = await load();
    expect(ctx.workspaceId).toBe(workspaceId); // same workspace row, found under the old name
    expect(ctx.paths.state).toBe(join(root, '.agent-conductor'));
    expect(ctx.paths.db).toBe(join(root, '.agent-conductor', 'db.sqlite'));
    expect(ctx.paths.weaver).toBe(join(root, 'conductor'));
    expect(existsSync(join(root, '.agent-conductor', 'runtimes', 'claude'))).toBe(true);
    // The whole safety claim: no second, empty .weave/weaver is created beside the real installation.
    expect(existsSync(join(root, '.weave'))).toBe(false);
    expect(existsSync(join(root, 'weaver'))).toBe(false);
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

  // VS-654: providers are daemon-only. A legacy `providers`/`disabledProviders` block loads, is
  // retained on every save (no stored data is deleted) and is resolved by nothing.
  it('loads and preserves a legacy workspace provider block, ignoring it (VS-654)', async () => {
    await loader.initWorkspace(root, { id: 'acme', name: 'Acme Labs', ticketPrefix: 'ACME' });
    const file = join(root, 'workspace.yaml');
    const raw = YAML.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
    writeFileSync(file, YAML.stringify({
      ...raw,
      providers: { legacy: { baseUrl: 'https://legacy.test/v1', auth: 'bearer', headers: {}, models: { m: {} } } },
      disabledProviders: ['gone'],
    }), 'utf8');

    // Loads without error, and keeps the block in memory (the schema does not strip it).
    const ctx = await load();
    expect(Object.keys(ctx.config.providers)).toEqual(['legacy']);
    expect(ctx.config.disabledProviders).toEqual(['gone']);
    // A second load exercises the once-per-process notice path and still does not throw.
    const again = await load();
    expect(again.config.id).toBe('acme');

    // A config write rewrites the file with the block still present: no stored data is deleted.
    await ctx.saveConfig({ ...ctx.config, name: 'Acme Labs Renamed' });
    const after = YAML.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
    expect(Object.keys(after['providers'] as Record<string, unknown>)).toEqual(['legacy']);
    expect(after['disabledProviders']).toEqual(['gone']);
    expect(after['name']).toBe('Acme Labs Renamed');
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
      projects: [{ id: 'api', url: 'git@github.com:acme/api.git', defaultBranch: 'main', maxWorkers: 4, warmPaths: [], setupCommand: 'pnpm install', openspec: { enabled: true }, knowledgeRepo: { enabled: false }, policies: {} }],
    });
    const toml = readFileSync(workspacePaths(root).wtConfig, 'utf8');
    expect(toml).toContain('[projects."github.com/acme/api"]');
    expect(toml).toContain('setup = "pnpm install"');
  });

  describe('config key rename: writes keep the legacy spelling on disk (VS-263 Decision 6)', () => {
    it('initWorkspace writes conductor:, not weaver:, even though the returned config is weaver-keyed', async () => {
      const config = await loader.initWorkspace(root, { id: 'acme', name: 'Acme Labs', ticketPrefix: 'ACME' });
      expect(config).toHaveProperty('weaver');
      expect(config).not.toHaveProperty('conductor');
      const raw = YAML.parse(readFileSync(join(root, 'workspace.yaml'), 'utf8')) as Record<string, unknown>;
      expect(raw).toHaveProperty('conductor');
      expect(raw).not.toHaveProperty('weaver');
    });

    it('saveConfig reverts weaver back to conductor on write, and the file still loads', async () => {
      await loader.initWorkspace(root, { id: 'acme', name: 'Acme Labs', ticketPrefix: 'ACME' });
      const ctx = await load();
      await ctx.saveConfig({
        ...ctx.config,
        weaver: { ...ctx.config.weaver, humanName: 'captain' },
        models: { ...ctx.config.models, weaver: { runtime: 'codex', model: 'gpt-5' } },
        defaults: { ...ctx.config.defaults, weaverDigestIntervalSec: 5 },
      });
      const raw = YAML.parse(readFileSync(join(root, 'workspace.yaml'), 'utf8')) as Record<string, unknown>;
      expect((raw['conductor'] as Record<string, unknown>)['humanName']).toBe('captain');
      expect((raw['models'] as Record<string, unknown>)['conductor']).toEqual({ runtime: 'codex', model: 'gpt-5' });
      expect((raw['defaults'] as Record<string, unknown>)['conductorDigestIntervalSec']).toBe(5);
      expect(raw).not.toHaveProperty('weaver');

      // A pre-VS-263 daemon (which only ever knew `conductor`) reads exactly the same file back
      // correctly — this is the literal rollback-safety claim.
      const reloaded = await load();
      expect(reloaded.config.weaver.humanName).toBe('captain');
      expect(reloaded.config.models.weaver).toEqual({ runtime: 'codex', model: 'gpt-5' });
      expect(reloaded.config.defaults.weaverDigestIntervalSec).toBe(5);
    });

    it('writeDaemonConfig reverts models.weaver back to models.conductor on write', () => {
      loader.writeDaemonConfig(DaemonConfigSchema.parse({ models: { weaver: { runtime: 'claude', model: 'x' } } }), cfgDir);
      const raw = YAML.parse(readFileSync(join(cfgDir, 'daemon.yaml'), 'utf8')) as Record<string, unknown>;
      expect((raw['models'] as Record<string, unknown>)['conductor']).toEqual({ runtime: 'claude', model: 'x' });
      expect(raw['models']).not.toHaveProperty('weaver');
      // A pre-VS-263 daemon reads this back correctly too.
      expect(loader.readDaemonConfig(cfgDir).models.weaver).toEqual({ runtime: 'claude', model: 'x' });
    });
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
      const db = openDbAsOf(workspacePaths(root).db, '0011_agent_pause_detail.sql');
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
        weaver: { runtime: 'claude', model: 'claude-fable-5-1' },
        workers: { runtime: 'codex', model: 'gpt-5' },
        workerOptions: [],
      });

      // Written back, and the layered keys are gone from the file for good. The file itself keeps
      // the legacy `conductor` spelling (VS-263 Decision 6 — rollback safety); only the in-memory
      // config is `weaver`.
      const written = yamlOf();
      expect(written['models']).toEqual({ conductor: ctx.config.models.weaver, workers: ctx.config.models.workers, workerOptions: ctx.config.models.workerOptions });
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
      expect(ctx.config.models).toEqual({ weaver: { runtime: 'opencode', model: 'grok' }, workers: { runtime: 'gemini', model: null }, workerOptions: [] });
    });

    it('writes the most used runtime and leaves the question open when the roles disagreed', async () => {
      await legacy({}, [
        { id: 'backend', runtime: 'codex' },
        { id: 'docs', runtime: 'codex' },
        { id: 'infra', runtime: 'claude' },
      ]);

      const ctx = await load();
      // The VS-77 derive migration always writes a concrete workers setting.
      expect(ctx.config.models.workers!.runtime).toBe('codex');
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

  // VS-284: precedence inverted (daemon is the default, workspace overrides). A stored workspace
  // value that a filled daemon overlay was already masking had no observable effect under the old
  // precedence, so it is cleared once rather than silently starting to win.
  describe('demasking a workspace setting a filled daemon overlay already governed', () => {
    const loadWithDaemon = async (daemonModels: Record<string, unknown>) => {
      const ctx = await loader.loadWorkspace(root, {
        daemon: DaemonConfigSchema.parse({ models: daemonModels }), registries: createRegistries(),
        loopbackUrl: 'http://127.0.0.1:7433', skillsDir: join(root, 'skills'), templatesDir: join(root, 'templates'), v2ThemeCss: '',
        daemonConfigDir: cfgDir, isolated: false,
      });
      opened.push(ctx.db);
      return ctx;
    };

    /** A workspace.yaml shaped like a real install: both settings stored, whether or not a human ever chose them. */
    async function withStoredModels(models: Record<string, unknown>): Promise<void> {
      await loader.initWorkspace(root, { id: 'acme', name: 'Acme Labs', ticketPrefix: 'ACME' });
      const file = join(root, 'workspace.yaml');
      const raw = YAML.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
      writeFileSync(file, YAML.stringify({ ...raw, models }), 'utf8');
    }

    const yamlOf = (): Record<string, unknown> => YAML.parse(readFileSync(join(root, 'workspace.yaml'), 'utf8')) as Record<string, unknown>;

    it('clears a masked control and keeps the daemon overlay in force, on this host\'s real shape', async () => {
      // Straight from the conductor's review comment: workspace.yaml holds opus/sonnet,
      // daemon.yaml overlays opus (weaver) and opencode/deepseek-flash (workers).
      await withStoredModels({
        conductor: { runtime: 'claude', model: 'opus' },
        workers: { runtime: 'claude', model: 'sonnet' },
        workerOptions: [],
      });

      const ctx = await loadWithDaemon({
        conductor: { runtime: 'claude', model: 'opus', effort: 'high' },
        workers: { runtime: 'opencode', model: 'deepseek-flash', effort: 'high' },
      });

      // Both stored settings are gone in memory and on disk...
      expect(ctx.config.models.weaver).toBeUndefined();
      expect(ctx.config.models.workers).toBeUndefined();
      expect(yamlOf()['models']).not.toHaveProperty('conductor');
      expect(yamlOf()['models']).not.toHaveProperty('workers');

      // ...and the effective workers setting is exactly what the daemon was already providing —
      // unchanged across the migration boundary, not flipped to the workspace's stale sonnet.
      expect(effectiveModels(ctx.daemon, ctx.config).workers).toEqual({ runtime: 'opencode', model: 'deepseek-flash', effort: 'high' });
      expect(effectiveModels(ctx.daemon, ctx.config).weaver).toEqual({ runtime: 'claude', model: 'opus', effort: 'high' });
    });

    it('leaves a control the daemon does not overlay untouched', async () => {
      await withStoredModels({
        conductor: { runtime: 'claude', model: 'opus' },
        workers: { runtime: 'claude', model: 'sonnet' },
        workerOptions: [],
      });

      const ctx = await loadWithDaemon({ workers: { runtime: 'opencode', model: 'deepseek-flash' } });

      // weaver's overlay is empty, so the workspace's own stored value is untouched and governs.
      expect(ctx.config.models.weaver).toEqual({ runtime: 'claude', model: 'opus' });
      expect(effectiveModels(ctx.daemon, ctx.config).weaver).toEqual({ runtime: 'claude', model: 'opus' });
      // workers is masked and cleared, so the overlay governs.
      expect(ctx.config.models.workers).toBeUndefined();
      expect(effectiveModels(ctx.daemon, ctx.config).workers).toEqual({ runtime: 'opencode', model: 'deepseek-flash' });
    });

    it('runs once: a later daemon overlay does not retroactively clear an unmasked setting', async () => {
      await withStoredModels({
        conductor: { runtime: 'claude', model: 'opus' },
        workers: { runtime: 'claude', model: 'sonnet' },
        workerOptions: [],
      });

      // First load: nothing overlaid, nothing cleared, migration marked done.
      const first = await loadWithDaemon({});
      expect(first.config.models.workers).toEqual({ runtime: 'claude', model: 'sonnet' });

      // An operator now fills the daemon's workers overlay for the first time. A second load must
      // not retroactively clear the workspace's setting: the migration already ran.
      const second = await loadWithDaemon({ workers: { runtime: 'opencode', model: 'deepseek-flash' } });
      expect(second.config.models.workers).toEqual({ runtime: 'claude', model: 'sonnet' });
      expect(effectiveModels(second.daemon, second.config).workers).toEqual({ runtime: 'claude', model: 'sonnet' });
    });

    it('a fresh workspace with nothing stored has nothing to clear', async () => {
      await loader.initWorkspace(root, { id: 'acme', name: 'Acme Labs', ticketPrefix: 'ACME' });
      const ctx = await loadWithDaemon({ workers: { runtime: 'opencode', model: 'deepseek-flash' } });
      expect(ctx.config.models.weaver).toBeUndefined();
      expect(ctx.config.models.workers).toBeUndefined();
      expect(effectiveModels(ctx.daemon, ctx.config).workers).toEqual({ runtime: 'opencode', model: 'deepseek-flash' });
    });

    it('an unconfigured setting round-trips through toLegacySpelling/YAML with the key absent, not null', async () => {
      await loader.initWorkspace(root, { id: 'acme', name: 'Acme Labs', ticketPrefix: 'ACME' });
      const ctx = await load();
      // `ctx.config.models.weaver` is undefined: a fresh workspace, nothing stored.
      expect(ctx.config.models.weaver).toBeUndefined();
      const text = YAML.stringify(toLegacySpelling(ctx.config));
      const raw = YAML.parse(text) as Record<string, unknown>;
      const models = raw['models'] as Record<string, unknown>;
      expect(models).not.toHaveProperty('conductor');
      expect(models).not.toHaveProperty('weaver');
      // Round-trips: a rollback (or this same daemon) reads it back cleanly, as unconfigured.
      const reparsed = WorkspaceConfigSchema.parse(raw);
      expect(reparsed.models.weaver).toBeUndefined();
    });
  });

  describe('telegram allowlist migration (VS-125)', () => {
    /** Writes `channels.telegram` into a fresh workspace.yaml exactly as given, pre-Zod. */
    async function withTelegram(telegram: Record<string, unknown> | undefined): Promise<void> {
      await loader.initWorkspace(root, { id: 'acme', name: 'Acme Labs', ticketPrefix: 'ACME' });
      const file = join(root, 'workspace.yaml');
      const raw = YAML.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
      const channels = telegram === undefined ? {} : { telegram };
      writeFileSync(file, YAML.stringify({ ...raw, channels }), 'utf8');
    }

    const yamlOf = (): Record<string, unknown> => YAML.parse(readFileSync(join(root, 'workspace.yaml'), 'utf8')) as Record<string, unknown>;

    const envVar = 'AC_TEST_TELEGRAM_TOKEN';
    afterEach(() => { delete process.env[envVar]; });

    it('no channels.telegram block at all: nothing written, migration still marked done', async () => {
      await withTelegram(undefined);
      const ctx = await load();
      expect((yamlOf()['channels'] as Record<string, unknown> | undefined)?.['telegram']).toBeUndefined();
      expect(ctx.db.get<{ value: string }>("SELECT value FROM meta WHERE key = 'telegram_allowlist_migrated'")?.value).toBe('1');
    });

    it('allowlist key never set, a secret-store token resolves: grandfathered to allowAll', async () => {
      await withTelegram({ enabled: true });
      createSecretStore(workspacePaths(root)).put('telegram-bot-token', 'stored-token');
      await load();
      expect((yamlOf()['channels'] as { telegram: Record<string, unknown> })['telegram']).toMatchObject({ allowAll: true });
    });

    it('allowlist key never set, a resolved ${ENV_VAR} token: also grandfathered to allowAll', async () => {
      process.env[envVar] = 'resolved-value';
      await withTelegram({ enabled: true, botToken: `\${${envVar}}` });
      await load();
      expect((yamlOf()['channels'] as { telegram: Record<string, unknown> })['telegram']).toMatchObject({ allowAll: true });
    });

    it('allowlist key never set, no token resolves anywhere: never reachable, not grandfathered', async () => {
      await withTelegram({ enabled: true });
      await load();
      expect((yamlOf()['channels'] as { telegram: Record<string, unknown> } | undefined)?.['telegram']).not.toHaveProperty('allowAll');
    });

    // This workspace's own config, verbatim, per the conductor's finding during review: an
    // allowlist explicitly set to empty is evidence of intent to restrict, not evidence of nothing.
    it('{enabled: true, allowlist: []} with a resolvable token: NOT grandfathered', async () => {
      await withTelegram({ enabled: true, allowlist: [] });
      createSecretStore(workspacePaths(root)).put('telegram-bot-token', 'stored-token');
      await load();
      const telegram = (yamlOf()['channels'] as { telegram: Record<string, unknown> })['telegram'];
      expect(telegram).not.toHaveProperty('allowAll');
    });

    it('a populated allowlist is migrated into allowedUserIds, invalid entries dropped, not grandfathered', async () => {
      await withTelegram({ enabled: true, allowlist: [111, 'not-an-id', 222] });
      createSecretStore(workspacePaths(root)).put('telegram-bot-token', 'stored-token');
      await load();
      const telegram = (yamlOf()['channels'] as { telegram: Record<string, unknown> })['telegram'];
      expect(telegram['allowedUserIds']).toEqual([111, 222]);
      expect(telegram).not.toHaveProperty('allowAll');
    });

    it('runs once: a second load makes no further change even if the allowlist is emptied afterward', async () => {
      await withTelegram({ enabled: true });
      createSecretStore(workspacePaths(root)).put('telegram-bot-token', 'stored-token');
      await load();
      expect((yamlOf()['channels'] as { telegram: Record<string, unknown> })['telegram']).toMatchObject({ allowAll: true });

      // Captain later clears the (now-honoured) allowlist back to empty — must not be re-evaluated.
      const file = join(root, 'workspace.yaml');
      const raw = yamlOf();
      writeFileSync(file, YAML.stringify({ ...raw, channels: { telegram: { enabled: true, allowAll: true, allowedUserIds: [] } } }), 'utf8');
      await load();
      expect((yamlOf()['channels'] as { telegram: Record<string, unknown> })['telegram']).toMatchObject({ allowAll: true, allowedUserIds: [] });
    });

    it('a fresh workspace configuring Telegram for the first time after migration has already run is not retroactively grandfathered', async () => {
      await withTelegram(undefined);
      await load(); // marks the workspace migrated with no telegram config yet

      const file = join(root, 'workspace.yaml');
      writeFileSync(file, YAML.stringify({ ...yamlOf(), channels: { telegram: { enabled: true } } }), 'utf8');
      createSecretStore(workspacePaths(root)).put('telegram-bot-token', 'stored-token');
      await load();
      expect((yamlOf()['channels'] as { telegram: Record<string, unknown> })['telegram']).not.toHaveProperty('allowAll');
    });
  });

  describe('YOLO mode migration (VS-382)', () => {
    const yamlOf = (): Record<string, unknown> => YAML.parse(readFileSync(join(root, 'workspace.yaml'), 'utf8')) as Record<string, unknown>;
    const decl = (id: string, policies: Record<string, unknown>): Record<string, unknown> => ({
      id, url: `git@example.com:acme/${id}.git`, defaultBranch: 'main', maxWorkers: 2, warmPaths: [],
      openspec: { enabled: true }, knowledgeRepo: { enabled: false }, policies,
    });
    const insertRow = (db: { insert: (t: string, v: Record<string, unknown>) => unknown }, workspaceId: string, slug: string, policies: Record<string, unknown>): void => {
      const now = nowIso();
      db.insert('projects', {
        id: newId(), workspaceId, slug, name: slug, gitUrl: `git@example.com:acme/${slug}.git`, defaultBranch: 'main',
        clonePath: join(root, 'projects', slug), maxWorkers: 2, worktreeProvider: 'git', openspecEnabled: 1,
        knowledgeRepoEnabled: 0, policiesJson: policies, status: 'ready', createdAt: now, updatedAt: now,
      });
    };

    it('copies defaults.yolo onto projects once, preserves an explicit false, and drops the key', async () => {
      await loader.initWorkspace(root, { id: 'acme', name: 'Acme Labs', ticketPrefix: 'ACME' });
      const first = await load();
      insertRow(first.db, first.workspaceId, 'api', {});
      insertRow(first.db, first.workspaceId, 'web', { yolo: false });

      const file = join(root, 'workspace.yaml');
      writeFileSync(file, YAML.stringify({
        ...yamlOf(),
        defaults: { ...(yamlOf()['defaults'] as Record<string, unknown>), yolo: true },
        projects: [decl('api', {}), decl('web', { yolo: false })],
      }), 'utf8');

      const ctx = await load();
      expect(ctx.config.projects.find((p) => p.id === 'api')!.policies.yolo).toBe(true);
      expect(ctx.config.projects.find((p) => p.id === 'web')!.policies.yolo).toBe(false);
      expect(yamlOf()['defaults']).not.toHaveProperty('yolo');
      // The row the daemon resolves YOLO from carries it too.
      expect(ctx.db.get<{ policies: Record<string, unknown> }>('SELECT policies_json FROM projects WHERE slug = ?', ['api'])!.policies.yolo).toBe(true);
      expect(ctx.db.get<{ policies: Record<string, unknown> }>('SELECT policies_json FROM projects WHERE slug = ?', ['web'])!.policies.yolo).toBe(false);
      expect(ctx.db.get<{ value: string }>("SELECT value FROM meta WHERE key = 'vs382_yolo_migrated'")?.value).toBe('1');
    });

    it('runs once: a project added later is not turned on', async () => {
      await loader.initWorkspace(root, { id: 'acme', name: 'Acme Labs', ticketPrefix: 'ACME' });
      const first = await load();
      insertRow(first.db, first.workspaceId, 'api', {});
      const file = join(root, 'workspace.yaml');
      writeFileSync(file, YAML.stringify({
        ...yamlOf(),
        defaults: { ...(yamlOf()['defaults'] as Record<string, unknown>), yolo: true },
        projects: [decl('api', {})],
      }), 'utf8');
      await load();

      // A project declared and rowed after the migration, with the (still present) old key set again.
      const after = await load();
      insertRow(after.db, after.workspaceId, 'new', {});
      writeFileSync(file, YAML.stringify({
        ...yamlOf(),
        defaults: { ...(yamlOf()['defaults'] as Record<string, unknown>), yolo: true },
        projects: [...(yamlOf()['projects'] as unknown[]), decl('new', {})],
      }), 'utf8');
      const ctx = await load();
      expect(ctx.config.projects.find((p) => p.id === 'new')!.policies.yolo).toBeUndefined();
      expect(ctx.db.get<{ policies: Record<string, unknown> }>('SELECT policies_json FROM projects WHERE slug = ?', ['new'])!.policies.yolo).toBeUndefined();
    });
  });

  it('reads and writes the daemon registry and config under XDG_CONFIG_HOME', () => {
    // VS-258: a fresh XDG_CONFIG_HOME (nothing on disk under either name) lands on the new name.
    expect(loader.configDir()).toBe(join(cfgDir, 'weave'));
    expect(loader.readRegistry().workspaces).toEqual([]);
    loader.writeRegistry({ workspaces: [{ id: 'acme', path: root }] });
    expect(loader.readRegistry().workspaces).toEqual([{ id: 'acme', path: root }]);

    const daemon = loader.readDaemonConfig();
    expect(daemon.http.listen).toBe('127.0.0.1:7433');
    loader.writeDaemonConfig({ ...daemon, logLevel: 'debug' });
    expect(loader.readDaemonConfig().logLevel).toBe('debug');
  });

  describe('ensureFreshDaemonConfig (VS-236)', () => {
    it('seeds the three unconfigured tiers when daemon.yaml is missing', () => {
      const dir = mkdtempSync(join(tmpdir(), 'ac-fresh-'));
      try {
        const cfg = loader.ensureFreshDaemonConfig(dir);
        expect(existsSync(join(dir, 'daemon.yaml'))).toBe(true);
        expect(cfg.models.workerOptions?.map((o) => o.id)).toEqual(['quick', 'standard', 'deep']);
        expect(cfg.models.workerOptions?.every((o) => o.runtime === null && o.model === null)).toBe(true);
        expect(cfg.models.weaver).toBeUndefined();
        expect(cfg.models.workers).toBeUndefined();
        expect(cfg.models.workerOptions?.[0]?.description).toContain('Fastest. The fix is already located');
        expect(cfg.models.workerOptions?.[1]?.description).toContain('Default for specified work');
        expect(cfg.models.workerOptions?.[2]?.description).toContain('Cause unknown');
        const roundTrip = loader.readDaemonConfig(dir);
        expect(roundTrip.models.workerOptions).toEqual(cfg.models.workerOptions);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it('leaves an existing daemon.yaml without models empty', () => {
      const dir = mkdtempSync(join(tmpdir(), 'ac-existing-'));
      try {
        writeFileSync(join(dir, 'daemon.yaml'), 'version: 1\n', 'utf8');
        const cfg = loader.ensureFreshDaemonConfig(dir);
        expect(cfg.models.workerOptions).toBeUndefined();
        expect(cfg.models.weaver).toBeUndefined();
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it('leaves an existing catalog overlay unchanged', () => {
      const dir = mkdtempSync(join(tmpdir(), 'ac-custom-'));
      try {
        writeFileSync(join(dir, 'daemon.yaml'), YAML.stringify({
          version: 1,
          models: {
            workerOptions: [{ id: 'cheap', description: 'Scouts.', runtime: 'opencode', model: 'glm-4.6' }],
          },
        }), 'utf8');
        const cfg = loader.ensureFreshDaemonConfig(dir);
        expect(cfg.models.workerOptions).toEqual([
          { id: 'cheap', description: 'Scouts.', runtime: 'opencode', model: 'glm-4.6' },
        ]);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  });

  describe('isDefaultConfigDir (VS-143, VS-258)', () => {
    it('is true for the plain default, regardless of how the value got there', () => {
      const plainDefault = join(homedir(), '.config', 'agent-conductor');
      expect(loader.isDefaultConfigDir(plainDefault)).toBe(true);
      // The generated systemd unit sets AC_CONFIG_HOME to exactly this path — still the default.
      expect(loader.isDefaultConfigDir(join(homedir(), '.config', 'agent-conductor'))).toBe(true);
    });

    it('is also true for the new name\'s plain default (VS-258)', () => {
      expect(loader.isDefaultConfigDir(join(homedir(), '.config', 'weave'))).toBe(true);
    });

    it('is unaffected by an ambiguous host installation — it compares identity directly, never through the refusing resolver (VS-258)', () => {
      // Neither directory need actually exist for this comparison: isDefaultConfigDir never touches
      // the filesystem, unlike configDir()'s own old/new/fresh resolution. This is the whole point —
      // a host that happens to have both plain defaults present must not make this check throw for
      // some unrelated, explicitly-scoped daemon.
      expect(() => loader.isDefaultConfigDir('/some/unrelated/scratch/dir')).not.toThrow();
      expect(loader.isDefaultConfigDir('/some/unrelated/scratch/dir')).toBe(false);
    });

    it('is false for a throwaway config dir, such as XDG_CONFIG_HOME resolves to in this suite', () => {
      expect(loader.isDefaultConfigDir(loader.configDir())).toBe(false);
      expect(loader.isDefaultConfigDir('/tmp/ac-dev/agent-conductor')).toBe(false);
    });
  });

  describe('isolation is carried onto the WorkspaceContext (VS-143)', () => {
    it('defaults to not isolated when the loader is given isolated: false', async () => {
      await loader.initWorkspace(root, { id: 'acme', name: 'Acme Labs', ticketPrefix: 'ACME' });
      const ctx = await load();
      expect(ctx.isolated).toBe(false);
      expect(ctx.daemonConfigDir).toBe(cfgDir);
    });

    it('is isolated when the loader is given isolated: true', async () => {
      await loader.initWorkspace(root, { id: 'acme', name: 'Acme Labs', ticketPrefix: 'ACME' });
      const ctx = await loader.loadWorkspace(root, {
        daemon: DaemonConfigSchema.parse({}), registries: createRegistries(),
        loopbackUrl: 'http://127.0.0.1:7433', skillsDir: join(root, 'skills'), templatesDir: join(root, 'templates'), v2ThemeCss: '',
        daemonConfigDir: cfgDir, isolated: true,
      });
      opened.push(ctx.db);
      expect(ctx.isolated).toBe(true);
    });
  });
});
