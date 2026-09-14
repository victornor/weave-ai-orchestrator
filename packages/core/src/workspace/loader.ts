import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, chmodSync, lstatSync, readlinkSync, renameSync, rmSync, symlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';
import YAML from 'yaml';
import { openDb, newId, nowIso } from '@weave-ai/db';
import { configDir as resolveConfigDir } from '@weave-ai/release';
import {
  DaemonConfigSchema, DEFAULT_KNOWLEDGE_BUDGETS, DEFAULT_WORKER_TIERS, TELEGRAM_BOT_TOKEN_SECRET_NAME, WorkspaceConfigSchema, WorkspaceRegistrySchema, OcError,
  daemonConfigToLegacySpelling, toLegacySpelling,
  type DaemonConfig, type KnowledgeBudgets, type WorkspaceConfig, type WorkspaceRegistry,
} from '@weave-ai/shared';
import type { Registries, WorkspaceContext } from '../context.js';
import { workspacePaths } from '../context.js';
import { EventBus } from '../events.js';
import { createPluginRegistry } from '../plugins/index.js';
import { PROJECT_SECTIONS } from '../knowledge/files.js';
import { getLogger } from '../logger.js';
import { registerBuiltinWorktreeProviders, writeWtConfig } from '../worktrees/index.js';
import { registerBuiltinForges } from '../forge/index.js';
import {
  ROLE_RUNTIMES_META_KEY, demaskWorkspaceModels, deriveModelSettings, effectiveModels, hasModelSettings, migrationLogFields, migrationSummary,
  recordPendingMigration, type RoleRuntimeRow,
} from '../models/index.js';
import { createSecretStore } from '../secrets/store.js';
import { planTelegramAllowlistMigration } from './telegramAllowlistMigration.js';
import type { LoadOptions, WorkspaceLoader } from './index.js';

export const WORKSPACE_FILE = 'workspace.yaml';

// ---------- config dir (daemon-level) ----------

/** VS-258: collapsed into `@weave-ai/release`, the one place old/new resolution happens. */
function configDir(): string {
  return resolveConfigDir();
}

/**
 * VS-258: the plain defaults with no override of any kind considered — VS-143's isolation boundary —
 * under either name this product is known by. Not run through `resolveConfigDir()`'s old/new/fresh
 * resolution: `isDefaultConfigDir` below only needs to recognise either literal spelling, and doing
 * that independently of resolution means a host with both plain defaults present (an ambiguous
 * installation, elsewhere a refused case) can never make this identity check itself throw for a
 * daemon that isn't even using either default. See design.md Decision 5 on the vs-258 change.
 */
function plainDefaultConfigDirs(): [old: string, new_: string] {
  return [join(homedir(), '.config', 'agent-conductor'), join(homedir(), '.config', 'weave')];
}

/**
 * VS-143: whether `resolved` is the host's one conventional config directory, regardless of how it
 * got there (no flag, or an env override that happens to point at the same place — the generated
 * systemd unit sets `AC_CONFIG_HOME` to exactly this path). Anything else is an isolated daemon:
 * see `daemon-isolation/credential-scope` and `daemon-isolation/dispatch-gate`.
 */
function isDefaultConfigDir(resolved: string): boolean {
  const r = resolve(resolved);
  return plainDefaultConfigDirs().some((d) => r === resolve(d));
}

function readYamlFile(path: string): unknown {
  if (!existsSync(path)) return undefined;
  const text = readFileSync(path, 'utf8');
  return YAML.parse(text) ?? {};
}

function writeYamlFile(path: string, value: unknown): void {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, YAML.stringify(value, { lineWidth: 0 }), 'utf8');
}

/**
 * VS-263 Decision 6: every write of `workspace.yaml` funnels through here, so the on-disk bytes keep
 * the pre-VS-263 spelling (`toLegacySpelling`) even though `config` itself, and everything derived
 * from it, is canonically `weaver`. Keeps `initWorkspace`, the two one-time migrations below, and
 * `saveConfig` from having to remember this individually.
 */
function writeWorkspaceYaml(file: string, config: WorkspaceConfig): void {
  writeYamlFile(file, toLegacySpelling(config));
}

// ---------- ${ENV} indirection ----------

const ENV_REF = /^\$\{([A-Z0-9_]+)\}$/;

function resolveEnvRefs<T>(value: T, back: Map<string, string>, missing: string[]): T {
  if (typeof value === 'string') {
    const m = value.match(ENV_REF);
    if (!m) return value;
    const name = m[1]!;
    const actual = process.env[name];
    if (actual === undefined || actual === '') { missing.push(name); return value; }
    back.set(actual, value);
    return actual as unknown as T;
  }
  if (Array.isArray(value)) return value.map((v) => resolveEnvRefs(v, back, missing)) as unknown as T;
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = resolveEnvRefs(v, back, missing);
    return out as unknown as T;
  }
  return value;
}

function unresolveEnvRefs<T>(value: T, back: Map<string, string>): T {
  if (back.size === 0) return value;
  if (typeof value === 'string') return (back.get(value) ?? value) as unknown as T;
  if (Array.isArray(value)) return value.map((v) => unresolveEnvRefs(v, back)) as unknown as T;
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = unresolveEnvRefs(v, back);
    return out as unknown as T;
  }
  return value;
}

// ---------- layout ----------

const KNOWLEDGE_SKELETONS: Array<[string, (cfg: { name: string; humanName: string; budgets: KnowledgeBudgets }) => string]> = [
  ['workspace/WORKSPACE.md', (c) => `# ${c.name}

<!-- Weaver-only. Budget ${c.budgets.workspace} tokens. Curated; keep entries concise, dated and standalone. -->

## What this business is

(fill in: what ${c.name} does and what "done" looks like)

## People and how they work

- ${c.humanName} — the human this workspace works for.

## Project portfolio

(one line per project: id — purpose — default role)

## Standing instructions

(policies that apply across projects)
`],
  ['workspace/SHARED.md', (c) => `# Shared conventions

<!-- Visible to every agent. Budget ${c.budgets.shared} tokens. Never name a project here. -->

## House rules

- Commit messages are imperative and scoped.
- Tests and lint run before anything is delivered.
- Ask instead of guessing when a decision changes scope or contract.

## Glossary

(terms every agent should share)
`],
  ['workspace/decisions.md', (c) => `# Decision log

<!-- Appended by the daemon from answered decisions marked durable. Budget ${c.budgets.decisions} tokens. -->
`],
];

/** The prompt under each canonical section of a fresh project knowledge base. */
const PROJECT_SECTION_HINTS: Record<(typeof PROJECT_SECTIONS)[number], string> = {
  'Overview': '(what this project is, who uses it)',
  'Stack & commands': '(run, test, lint, build)',
  'Conventions': '(project-specific rules the repo docs do not state — once a subject has its own document, put its rules there via weave_knowledge_note(..., doc: slug) and leave a one-line pointer here)',
  'Current focus': '(what is being worked toward this month)',
  'Landmines': "(things that bite — one subject, one document, from the first entry on; don't wait for a second one to justify creating it, and leave a one-line pointer here once it exists)",
  'Documents': '(one line per linked document: `[[slug]] — what it covers`)',
  'Learnings': '(dated, concise entries from workers)',
};

const PROJECT_SKELETON = (id: string, budget: number) => [
  `# ${id}`,
  '',
  `<!-- The project knowledge base. Budget ${budget} tokens. Workers append concise dated learnings. -->`,
  ...PROJECT_SECTIONS.flatMap((s) => ['', `## ${s}`, '', PROJECT_SECTION_HINTS[s]]),
  '',
].join('\n');

export function projectKnowledgeSkeleton(id: string, budgetTokens = DEFAULT_KNOWLEDGE_BUDGETS.project): string {
  return PROJECT_SKELETON(id, budgetTokens);
}

function ensureLayout(root: string, stateDir?: string): void {
  const p = workspacePaths(root);
  const state = stateDir ?? p.state;
  for (const dir of [
    root, state, join(state, 'runs'), join(state, 'runtimes'), join(state, 'sessions'),
    p.weaver, p.roles, p.workers, p.archive, p.projects,
    join(p.knowledge, 'workspace'), join(p.knowledge, 'projects'),
  ]) mkdirSync(dir, { recursive: true });
}

// ---------- loader ----------

class Loader implements WorkspaceLoader {
  configDir(): string { return configDir(); }
  isDefaultConfigDir(resolved: string): boolean { return isDefaultConfigDir(resolved); }

  async initWorkspace(dir: string, init: { id: string; name: string; ticketPrefix: string }): Promise<WorkspaceConfig> {
    const root = resolve(dir);
    const file = join(root, WORKSPACE_FILE);
    if (existsSync(file)) throw new OcError('conflict', `workspace.yaml already exists at ${file}`);
    const config = WorkspaceConfigSchema.parse({ version: 1, id: init.id, name: init.name, ticketPrefix: init.ticketPrefix });
    ensureLayout(root);
    writeWorkspaceYaml(file, config);

    const humanName = config.weaver.humanName ?? 'captain';
    for (const [rel, body] of KNOWLEDGE_SKELETONS) {
      const path = join(root, 'knowledge', rel);
      if (!existsSync(path)) { mkdirSync(join(path, '..'), { recursive: true }); writeFileSync(path, body({ name: config.name, humanName, budgets: config.defaults.knowledgeBudgetTokens }), 'utf8'); }
    }
    const gitignore = join(workspacePaths(root).state, '.gitignore');
    if (!existsSync(gitignore)) writeFileSync(gitignore, '*\n', 'utf8');
    writeWtConfig(workspacePaths(root).wtConfig, []);
    return config;
  }

  async loadWorkspace(dir: string, opts: LoadOptions): Promise<WorkspaceContext> {
    const root = resolve(dir);
    const file = join(root, WORKSPACE_FILE);
    const raw = readYamlFile(file);
    if (raw === undefined) throw new OcError('not_found', `no ${WORKSPACE_FILE} in ${root}`);
    const parsed = WorkspaceConfigSchema.safeParse(raw);
    if (!parsed.success) {
      throw new OcError('validation', `invalid ${WORKSPACE_FILE}: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
    }
    const envBack = new Map<string, string>();
    const missing: string[] = [];
    const config = resolveEnvRefs(parsed.data, envBack, missing);

    const log = getLogger('daemon', { workspace: config.id });
    if (missing.length) log.warn({ missing }, 'workspace.yaml references environment variables that are not set');

    ensureLayout(root, opts.stateDir);
    const paths = opts.stateDir
      ? { ...workspacePaths(root), state: opts.stateDir, db: join(opts.stateDir, 'db.sqlite'), runs: join(opts.stateDir, 'runs'), runtimesHome: join(opts.stateDir, 'runtimes'), wtConfig: join(opts.stateDir, 'wt.toml') }
      : workspacePaths(root);

    const db = openDb(paths.db);
    let ws = db.get<{ id: string }>('SELECT id FROM workspaces WHERE slug = ?', [config.id]);
    const now = nowIso();
    if (!ws) {
      const id = newId();
      db.insert('workspaces', { id, slug: config.id, name: config.name, ticketPrefix: config.ticketPrefix, status: 'active', rootPath: root, settingsJson: {}, createdAt: now, updatedAt: now });
      ws = { id };
    } else {
      db.update('workspaces', ws.id, { name: config.name, ticketPrefix: config.ticketPrefix, rootPath: root, updatedAt: now });
    }

    // VS-77: bring a workspace configured under the old layered scheme onto the two model settings.
    // Migration 0012 stashed what the roles were running on before it dropped the columns; the raw
    // YAML still carries the keys Zod has already stripped from `config`. Writing the parsed config
    // back is what removes them for good, so this runs once.
    const stashed = db.get<{ value: string }>('SELECT value FROM meta WHERE key = ?', [ROLE_RUNTIMES_META_KEY]);
    if (stashed) {
      if (!hasModelSettings(raw as Record<string, unknown>)) {
        let roleRows: RoleRuntimeRow[] = [];
        try { roleRows = JSON.parse(stashed.value) as RoleRuntimeRow[]; } catch { roleRows = []; }
        const migration = deriveModelSettings(raw as Record<string, unknown>, roleRows);
        config.models = migration.models;
        writeWorkspaceYaml(file, unresolveEnvRefs(config, envBack));
        log.info(migrationLogFields(migration), `model settings derived: ${migrationSummary(migration)}`);
        if (migration.ambiguous) recordPendingMigration(db, ws.id, migration);
      }
      db.run('DELETE FROM meta WHERE key = ?', [ROLE_RUNTIMES_META_KEY]);
    }

    // VS-125: see telegramAllowlistMigration.ts for the full reasoning. Runs once per workspace,
    // gated by this meta row rather than by the shape of the config alone — a value-only check
    // ("no allowAll key, no ids") cannot tell a workspace that has been open for months apart from
    // one enabling Telegram for the very first time after this code shipped.
    const telegramAllowlistMigrated = db.get<{ value: string }>("SELECT value FROM meta WHERE key = 'telegram_allowlist_migrated'");
    if (!telegramAllowlistMigrated) {
      const rawTelegram = (raw as { channels?: Record<string, unknown> } | undefined)?.channels?.['telegram'] as Record<string, unknown> | undefined;
      const configuredToken = config.channels['telegram']?.['botToken'] as string | undefined;
      const hasResolvableToken = Boolean(configuredToken && !ENV_REF.test(configuredToken)) || Boolean(createSecretStore(paths).get(TELEGRAM_BOT_TOKEN_SECRET_NAME));
      const plan = planTelegramAllowlistMigration(rawTelegram, hasResolvableToken);
      if (plan.dropped.length) {
        log.warn({ dropped: plan.dropped, kept: 'allowedUserIds' in (plan.patch ?? {}) ? (plan.patch as { allowedUserIds: number[] }).allowedUserIds.length : 0 },
          'telegram allowlist: entries that were not valid ids were dropped during migration');
      }
      if (plan.patch) {
        config.channels['telegram'] = { ...(config.channels['telegram'] ?? {}), ...plan.patch };
        writeWorkspaceYaml(file, unresolveEnvRefs(config, envBack));
        log.info({ patch: plan.patch }, 'telegram allowlist migrated');
      }
      db.run('INSERT INTO meta (key, value) VALUES (?, ?)', ['telegram_allowlist_migrated', '1']);
    }

    // VS-284: precedence inverted — a workspace's own setting now wins over a filled daemon
    // overlay, where the overlay used to win. A stored value that a filled overlay was already
    // masking had no observable effect under the old precedence, so it is not a deliberate choice
    // worth keeping; clear it once here so the overlay keeps governing across the upgrade instead
    // of the workspace's previously-inert value silently starting to win. Runs once per workspace,
    // after the VS-77 migration above (so it always sees the two-settings shape) and before
    // `effectiveModels` is computed below.
    const demaskMigrated = db.get<{ value: string }>("SELECT value FROM meta WHERE key = 'vs284_masked_settings_cleared'");
    if (!demaskMigrated) {
      const { models: demasked, cleared } = demaskWorkspaceModels(config.models, opts.daemon);
      if (Object.keys(cleared).length > 0) {
        config.models = demasked;
        writeWorkspaceYaml(file, unresolveEnvRefs(config, envBack));
        log.info({ cleared, daemonModels: opts.daemon?.models }, 'workspace model settings masked by a filled daemon overlay were cleared (VS-284)');
      }
      db.run('INSERT INTO meta (key, value) VALUES (?, ?)', ['vs284_masked_settings_cleared', '1']);
    }

    // VS-382: YOLO was a workspace-wide default (`defaults.yolo`) that every project without its
    // own override inherited. It is now a per-project setting with no workspace fallback, so copy
    // the old default onto each existing project once, preserving an explicit project opt-out. The
    // key is dropped from the rewritten workspace.yaml because VS-382 removed it from the schema.
    // Gated by a meta row: a workspace that never had the old default should not be visited again,
    // and a project added later must not receive it.
    const yoloMigrated = db.get<{ value: string }>("SELECT value FROM meta WHERE key = 'vs382_yolo_migrated'");
    if (!yoloMigrated) {
      const rawDefaults = (raw as { defaults?: Record<string, unknown> } | undefined)?.defaults;
      if (rawDefaults?.['yolo'] === true) {
        let changed = 0;
        const declared = new Set(config.projects.map((p) => p.id));
        config.projects = config.projects.map((p) => {
          if (p.policies.yolo !== undefined) return p;
          changed += 1;
          return { ...p, policies: { ...p.policies, yolo: true } };
        });
        const rows = db.all<{ id: string; slug: string; policies: Record<string, unknown> | null }>(
          "SELECT id, slug, policies_json FROM projects WHERE workspace_id = ? AND status != 'archived'", [ws.id],
        );
        for (const row of rows) {
          if ((row.policies ?? {})['yolo'] !== undefined) continue;
          db.update('projects', row.id, { policiesJson: { ...(row.policies ?? {}), yolo: true }, updatedAt: now });
          if (!declared.has(row.slug)) changed += 1;
        }
        writeWorkspaceYaml(file, unresolveEnvRefs(config, envBack));
        db.run('INSERT INTO meta (key, value) VALUES (?, ?)', ['vs382_yolo_migrated', '1']);
        log.info({ projects: changed }, 'workspace YOLO default copied onto projects (VS-382)');
      }
    }

    // Per-workspace runtime config homes (CLAUDE_CONFIG_DIR / CODEX_HOME / XDG_CONFIG_HOME …).
    const models = effectiveModels(opts.daemon, config);
    const runtimeIds = new Set<string>([
      ...opts.registries.runtimes.keys(),
      models.weaver.runtime,
      models.workers.runtime,
      ...models.workerOptions.map((o) => o.runtime).filter((id): id is string => id != null),
    ]);
    for (const id of runtimeIds) {
      if (!id) continue;
      mkdirSync(join(paths.runtimesHome, id), { recursive: true });
      linkRuntimeCredentials(id, join(paths.runtimesHome, id), {
        readCredential: credentialReaderFor(opts.registries, id),
        isolated: opts.isolated, daemonConfigDir: opts.daemonConfigDir,
      });
    }

    writeWtConfig(paths.wtConfig, config.projects);
    registerBuiltinWorktreeProviders(opts.registries);
    registerBuiltinForges(opts.registries);

    const ctx: WorkspaceContext = {
      workspaceId: ws.id,
      config,
      daemon: opts.daemon,
      paths,
      db,
      events: new EventBus(db, ws.id),
      registries: opts.registries,
      plugins: createPluginRegistry(),
      log: (domain) => getLogger(domain, { workspace: config.id }),
      loopbackUrl: opts.loopbackUrl,
      skillsDir: opts.skillsDir,
      templatesDir: opts.templatesDir,
      v2ThemeCss: opts.v2ThemeCss,
      isolated: opts.isolated,
      daemonConfigDir: opts.daemonConfigDir,
      async saveConfig(next: WorkspaceConfig): Promise<void> {
        const validated = WorkspaceConfigSchema.parse(next);
        writeWorkspaceYaml(file, unresolveEnvRefs(validated, envBack));
        ctx.config = validated;
        writeWtConfig(paths.wtConfig, validated.projects);
        ctx.db.update('workspaces', ctx.workspaceId, { name: validated.name, ticketPrefix: validated.ticketPrefix, updatedAt: nowIso() });
      },
    };
    return ctx;
  }

  readRegistry(dir?: string): WorkspaceRegistry {
    const path = join(dir ?? configDir(), 'workspaces.yaml');
    const raw = readYamlFile(path);
    if (raw === undefined) return { workspaces: [] };
    const parsed = WorkspaceRegistrySchema.safeParse(raw);
    if (!parsed.success) throw new OcError('validation', `invalid workspaces.yaml: ${parsed.error.issues.map((i) => i.message).join('; ')}`);
    return parsed.data;
  }

  writeRegistry(reg: WorkspaceRegistry, dir?: string): void {
    writeYamlFile(join(dir ?? configDir(), 'workspaces.yaml'), WorkspaceRegistrySchema.parse(reg));
  }

  readDaemonConfig(dir?: string): DaemonConfig {
    const path = join(dir ?? configDir(), 'daemon.yaml');
    const raw = readYamlFile(path);
    const parsed = DaemonConfigSchema.safeParse(raw ?? {});
    if (!parsed.success) throw new OcError('validation', `invalid daemon.yaml: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
    return parsed.data;
  }

  writeDaemonConfig(cfg: DaemonConfig, dir?: string): void {
    // VS-263 Decision 6: daemon.yaml keeps the legacy `conductor` spelling on disk for now
    // (rollback safety) — see `daemonConfigToLegacySpelling`'s doc comment before removing this.
    writeYamlFile(join(dir ?? configDir(), 'daemon.yaml'), daemonConfigToLegacySpelling(DaemonConfigSchema.parse(cfg)));
  }

  ensureFreshDaemonConfig(dir?: string): DaemonConfig {
    const path = join(dir ?? configDir(), 'daemon.yaml');
    if (existsSync(path)) return this.readDaemonConfig(dir);
    const seeded = DaemonConfigSchema.parse({ models: { workerOptions: DEFAULT_WORKER_TIERS } });
    this.writeDaemonConfig(seeded, dir);
    return seeded;
  }
}

export const loader: WorkspaceLoader = new Loader();

/**
 * The one credential per runtime per host (VS-75).
 *
 * The workspace's runtime config home holds a *symlink* to the credential file the machine owner's
 * own CLI reads and writes, never a copy of it. Claude's OAuth rotates the refresh token on every
 * refresh, so two live copies race and whichever refreshes first invalidates the other; the outage
 * of 2026-09-07 was exactly that. Session history and project state stay per workspace.
 *
 * OpenCode's config (`opencode.json` / `opencode.jsonc`) is *generated* per workspace rather than
 * linked (VS-443): it carries the owner's `provider` definitions, so a model the owner's CLI can run
 * is a model a turn can run, but not the owner's `mcp` servers or `plugin` entries — a worker must
 * not load another workspace's tools into its prompt. It is regenerated on every launch, so a
 * provider edited in the owner's config reaches the next turn. Isolated daemons (VS-143) still never
 * resolve to the real host path.
 */

/**
 * Host path -> workspace path, per runtime. The host path is always the canonical one — except for
 * an isolated daemon (VS-143), which never resolves to the real host path: each pair's host side
 * moves inside that daemon's own config directory instead, so the daemon needs its own login for the
 * runtime to work at all rather than silently reading the owner's real credential. See
 * `daemon-isolation/credential-scope`.
 */
function credentialPaths(runtimeId: string, home: string, host: { isolated: boolean; daemonConfigDir: string }): Array<[string, string]> {
  const h = process.env.HOME ?? '';
  const candidates: Record<string, Array<[string, string]>> = {
    claude: [[join(h, '.claude', '.credentials.json'), join(home, '.credentials.json')]],
    codex: [[join(h, '.codex', 'auth.json'), join(home, 'auth.json')]],
    gemini: [[join(h, '.gemini', 'oauth_creds.json'), join(home, 'oauth_creds.json')], [join(h, '.gemini', 'google_accounts.json'), join(home, 'google_accounts.json')]],
    // VS-443: opencode's config files are generated, not linked — see `generateOpencodeWorkerConfig`.
    opencode: [[join(h, '.local', 'share', 'opencode', 'auth.json'), join(home, 'opencode', 'auth.json')]],
      cursor: [[join(h, '.config', 'cursor', 'auth.json'), join(home, 'auth.json')]],
  };
  const pairs = candidates[runtimeId] ?? [];
  if (!host.isolated) return pairs;
  return pairs.map(([, dst]) => [join(host.daemonConfigDir, 'credentials', runtimeId, basename(dst)), dst]);
}

/** VS-443: the keys a worker needs from the owner's opencode config; everything else is personal. */
const OPENCODE_WORKER_CONFIG_KEYS = ['$schema', 'autoupdate', 'provider'] as const;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Strip `//` and block comments from JSONC, string-aware so a `//` inside a URL is left alone. */
function stripJsonComments(text: string): string {
  let out = '';
  let inString = false;
  let inLine = false;
  let inBlock = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i]!;
    if (inLine) { if (c === '\n') { inLine = false; out += c; } continue; }
    if (inBlock) { if (c === '*' && text[i + 1] === '/') { inBlock = false; i += 1; } continue; }
    if (inString) {
      out += c;
      if (c === '\\') { const esc = text[i + 1]; if (esc !== undefined) { out += esc; i += 1; } continue; }
      if (c === '"') inString = false;
      continue;
    }
    if (c === '"') { inString = true; out += c; continue; }
    if (c === '/' && text[i + 1] === '/') { inLine = true; i += 1; continue; }
    if (c === '/' && text[i + 1] === '*') { inBlock = true; i += 1; continue; }
    out += c;
  }
  return out;
}

/** Drop a comma immediately before a closing brace/bracket, string-aware (JSONC trailing commas). */
function stripTrailingCommas(text: string): string {
  let out = '';
  let inString = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i]!;
    if (inString) {
      out += c;
      if (c === '\\') { const esc = text[i + 1]; if (esc !== undefined) { out += esc; i += 1; } continue; }
      if (c === '"') inString = false;
      continue;
    }
    if (c === '"') { inString = true; out += c; continue; }
    if (c === ',') {
      let j = i + 1;
      while (j < text.length && /\s/.test(text[j]!)) j += 1;
      if (text[j] === '}' || text[j] === ']') continue;
    }
    out += c;
  }
  return out;
}

/** Parse an opencode config file, tolerating JSONC. Throws when it cannot be read or parsed. */
function parseOpencodeConfig(path: string): Record<string, unknown> {
  const parsed = JSON.parse(stripTrailingCommas(stripJsonComments(readFileSync(path, 'utf8')))) as unknown;
  if (!isRecord(parsed)) throw new Error('opencode config is not a JSON object');
  return parsed;
}

/** Where the owner's opencode config lives: the host's, or an isolated daemon's own credential dir. */
function opencodeHostConfigDir(host: { isolated: boolean; daemonConfigDir: string }): string {
  const h = process.env.HOME ?? '';
  return host.isolated ? join(host.daemonConfigDir, 'credentials', 'opencode') : join(h, '.config', 'opencode');
}

/** A symlink test that does not throw on a missing path. */
function isSymlink(path: string): boolean {
  try { return lstatSync(path).isSymbolicLink(); } catch { return false; }
}

/**
 * VS-443: write the per-workspace opencode config a worker may load.
 *
 * Carries only `$schema`, `autoupdate` and `provider` from the owner's own `opencode.json` /
 * `opencode.jsonc`. A worker must never inherit the owner's `mcp` servers (another workspace's tools
 * would load into every request) or `plugin` entries, so neither is copied. `auth.json` stays the
 * shared credential.
 *
 * The generated file is 0600: it copies the owner's inline provider keys, which the owner's own
 * 0600 file keeps private, so a default 0644 would leak them. It is written atomically via a 0600
 * temp file and a rename, so a worker starting mid-regeneration never sees a missing or partial
 * config (which would drop the owner's custom providers). A read or write failure leaves the
 * previous generated file in place and deletes nothing.
 *
 * Returns true only when a config was generated.
 */
export function generateOpencodeWorkerConfig(hostConfigDir: string, workspaceConfigHome: string): boolean {
  const dir = join(workspaceConfigHome, 'opencode');
  const dst = join(dir, 'opencode.json');
  const dstc = join(dir, 'opencode.jsonc');

  const merged: Record<string, unknown> = {};
  let sawSource = false;
  for (const name of ['opencode.jsonc', 'opencode.json']) {
    const path = join(hostConfigDir, name);
    if (!existsSync(path)) continue;
    let parsed: Record<string, unknown>;
    try { parsed = parseOpencodeConfig(path); }
    catch (e) {
      // Keep last time's generated file rather than delete it and drop the owner's providers.
      getLogger('runtime').warn({ runtime: 'opencode', source: name, err: String(e) }, 'opencode config unreadable; keeping the previous worker config');
      return false;
    }
    sawSource = true;
    for (const key of OPENCODE_WORKER_CONFIG_KEYS) {
      const value = parsed[key];
      if (value === undefined) continue;
      merged[key] = key === 'provider' && isRecord(value) && isRecord(merged[key])
        ? { ...(merged[key] as Record<string, unknown>), ...value }
        : value;
    }
  }

  if (!sawSource || Object.keys(merged).length === 0) {
    // The owner has no config, or nothing a worker needs: drop our own stale output and the old
    // host symlink, and write nothing.
    try {
      rmSync(dst, { force: true });
      if (isSymlink(dstc)) rmSync(dstc, { force: true });
    } catch (e) {
      getLogger('runtime').warn({ runtime: 'opencode', err: String(e) }, 'could not clear the stale opencode worker config');
    }
    return false;
  }

  let tmp: string | null = null;
  try {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true, mode: 0o700 });
      chmodSync(dir, 0o700);
    }
    // An upgraded workspace holds the *host's* file here as a symlink. Unlink it first so nothing
    // ever writes through it into the owner's own config; a regular generated file needs no unlink —
    // the rename below replaces it atomically.
    if (isSymlink(dst)) rmSync(dst, { force: true });
    tmp = join(dir, `.opencode.json.${process.pid}.${Date.now()}.tmp`);
    writeFileSync(tmp, `${JSON.stringify(merged, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    chmodSync(tmp, 0o600);
    renameSync(tmp, dst);
    tmp = null;
    chmodSync(dst, 0o600);
    try { chmodSync(dir, 0o700); } catch { /* the file itself is 0600; the dir mode is best-effort */ }
    // opencode would merge a personal `opencode.jsonc`; only a previous version ever put one here.
    if (isSymlink(dstc)) rmSync(dstc, { force: true });
    return true;
  } catch (e) {
    if (tmp) { try { rmSync(tmp, { force: true }); } catch { /* nothing to clean */ } }
    getLogger('runtime').warn({ runtime: 'opencode', err: String(e) }, 'could not write the opencode worker config; keeping the previous one');
    return false;
  }
}

/**
 * Reads a credential's own facts from a config home. Supplied by the caller, which has the runtime
 * registries; `core` may not import a runtime package. The config home of a credential file is its
 * containing directory, which is what the runtimes implementing the hook expect.
 */
export type CredentialReader = (configHome: string) => { present: boolean; expiresAt: string | null };

/** The reader a runtime offers, or undefined when it cannot describe its credential. */
export function credentialReaderFor(registries: Registries, runtimeId: string): CredentialReader | undefined {
  const adapter = registries.runtimes.get(runtimeId);
  if (!adapter?.readCredential) return undefined;
  return (configHome: string) => adapter.readCredential!({ configHome });
}

/** Is `path` already a symlink resolving to `target`? */
function linksTo(path: string, target: string): boolean {
  try {
    if (!lstatSync(path).isSymbolicLink()) return false;
    return resolve(dirname(path), readlinkSync(path)) === resolve(target);
  } catch { return false; }
}

/** Point `dst` at `src`, replacing whatever is there. `src` is left at 0600. */
function linkTo(src: string, dst: string): void {
  mkdirSync(dirname(dst), { recursive: true });
  rmSync(dst, { force: true });
  symlinkSync(src, dst);
  try { chmodSync(src, 0o600); } catch { /* the owner's own file; mode is theirs */ }
}

/**
 * One credential pair, reconciled to a single file.
 *
 * A CLI that writes its credential by renaming a temp file over the path replaces the *symlink*
 * rather than following it, so the credential can fork again on any turn. This puts it back, and
 * decides which of the two survives by the expiry the credentials themselves carry — never by
 * modification time, which a copy resets and which says nothing about which token is live.
 *
 * The host file is only ever replaced when the workspace's is *provably* newer: both expiries
 * readable and the workspace's later. An unreadable expiry is never a reason to overwrite a
 * credential we cannot reason about (a `claude setup-token` credential legitimately carries none).
 */
function reconcileOne(src: string, dst: string, read?: CredentialReader): void {
  if (linksTo(dst, src)) return;

  const dstIsFile = (() => { try { return lstatSync(dst).isFile(); } catch { return false; } })();

  if (!existsSync(src)) {
    // No host credential. A workspace that had its own login keeps it, promoted to the host path,
    // so upgrading a workspace that was logged in separately does not sign anyone out.
    if (dstIsFile) { mkdirSync(dirname(src), { recursive: true }); copyFileSync(dst, src); linkTo(src, dst); }
    return;
  }
  if (!dstIsFile) { linkTo(src, dst); return; }

  const expiry = (path: string): string | null => (read ? read(dirname(path)).expiresAt : null);
  const theirs = expiry(dst);
  const ours = expiry(src);
  if (theirs !== null && ours !== null && theirs > ours) copyFileSync(dst, src);
  linkTo(src, dst);
}

/**
 * Share the host user's credential for `runtimeId` into a per-workspace runtime config home, and
 * repair the sharing if a CLI has replaced the link. Idempotent and best-effort per file: one
 * unreadable path must not stop the others.
 */
export function linkRuntimeCredentials(
  runtimeId: string, home: string,
  opts: { readCredential?: CredentialReader; isolated?: boolean; daemonConfigDir?: string } = {},
): void {
  const host = { isolated: opts.isolated ?? false, daemonConfigDir: opts.daemonConfigDir ?? '' };
  for (const [src, dst] of credentialPaths(runtimeId, home, host)) {
    try { reconcileOne(src, dst, opts.readCredential); } catch { /* best effort */ }
  }
  // VS-443: opencode's config is generated, not linked, so a worker keeps the owner's providers but
  // never their `mcp` servers or plugins. Regenerated here on load and on every turn.
  if (runtimeId === 'opencode') {
    try { generateOpencodeWorkerConfig(opencodeHostConfigDir(host), home); }
    catch (e) {
      getLogger('runtime').warn({ runtime: 'opencode', err: String(e) }, 'opencode worker config generation failed');
    }
  }
}

/** Alias kept for the reconcile call sites, which read as a repair rather than a first link. */
export const reconcileRuntimeCredential = linkRuntimeCredentials;
