import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, chmodSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import YAML from 'yaml';
import { openDb, newId, nowIso } from '@agent-conductor/db';
import {
  DaemonConfigSchema, DEFAULT_KNOWLEDGE_BUDGETS, WorkspaceConfigSchema, WorkspaceRegistrySchema, OcError,
  type DaemonConfig, type KnowledgeBudgets, type WorkspaceConfig, type WorkspaceRegistry,
} from '@agent-conductor/shared';
import type { WorkspaceContext } from '../context.js';
import { workspacePaths } from '../context.js';
import { EventBus } from '../events.js';
import { PROJECT_SECTIONS } from '../knowledge/files.js';
import { getLogger } from '../logger.js';
import { registerBuiltinWorktreeProviders, writeWtConfig } from '../worktrees/index.js';
import { registerBuiltinForges } from '../forge/index.js';
import type { LoadOptions, WorkspaceLoader } from './index.js';

export const WORKSPACE_FILE = 'workspace.yaml';

// ---------- config dir (daemon-level) ----------

function configDir(): string {
  if (process.env.AC_CONFIG_HOME) return process.env.AC_CONFIG_HOME;
  const xdg = process.env.XDG_CONFIG_HOME;
  return xdg && xdg.trim().length ? join(xdg, 'agent-conductor') : join(homedir(), '.config', 'agent-conductor');
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

<!-- Conductor-only. Budget ${c.budgets.workspace} tokens. Curated; keep entries concise, dated and standalone. -->

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
  'Conventions': '(project-specific rules the repo docs do not state)',
  'Current focus': '(what is being worked toward this month)',
  'Landmines': '(things that bite)',
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
    p.conductor, p.roles, p.workers, p.archive, p.projects,
    join(p.knowledge, 'workspace'), join(p.knowledge, 'projects'),
  ]) mkdirSync(dir, { recursive: true });
}

// ---------- loader ----------

class Loader implements WorkspaceLoader {
  configDir(): string { return configDir(); }

  async initWorkspace(dir: string, init: { id: string; name: string; ticketPrefix: string }): Promise<WorkspaceConfig> {
    const root = resolve(dir);
    const file = join(root, WORKSPACE_FILE);
    if (existsSync(file)) throw new OcError('conflict', `workspace.yaml already exists at ${file}`);
    const config = WorkspaceConfigSchema.parse({ version: 1, id: init.id, name: init.name, ticketPrefix: init.ticketPrefix });
    ensureLayout(root);
    writeYamlFile(file, config);

    const humanName = config.conductor.humanName ?? 'captain';
    for (const [rel, body] of KNOWLEDGE_SKELETONS) {
      const path = join(root, 'knowledge', rel);
      if (!existsSync(path)) { mkdirSync(join(path, '..'), { recursive: true }); writeFileSync(path, body({ name: config.name, humanName, budgets: config.defaults.knowledgeBudgetTokens }), 'utf8'); }
    }
    const gitignore = join(root, '.agent-conductor', '.gitignore');
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

    // Per-workspace runtime config homes (CLAUDE_CONFIG_DIR / CODEX_HOME / XDG_CONFIG_HOME …).
    const runtimeIds = new Set<string>([...opts.registries.runtimes.keys(), config.defaults.runtime, config.conductor.runtime, ...config.projects.map((p) => p.runtime ?? config.defaults.runtime)]);
    for (const id of runtimeIds) if (id) { mkdirSync(join(paths.runtimesHome, id), { recursive: true }); seedRuntimeCredentials(id, join(paths.runtimesHome, id)); }

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
      log: (domain) => getLogger(domain, { workspace: config.id }),
      loopbackUrl: opts.loopbackUrl,
      skillsDir: opts.skillsDir,
      templatesDir: opts.templatesDir,
      async saveConfig(next: WorkspaceConfig): Promise<void> {
        const validated = WorkspaceConfigSchema.parse(next);
        writeYamlFile(file, unresolveEnvRefs(validated, envBack));
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
    writeYamlFile(join(dir ?? configDir(), 'daemon.yaml'), DaemonConfigSchema.parse(cfg));
  }
}

export const loader: WorkspaceLoader = new Loader();

/**
 * Inherit the host user's CLI credentials into a per-workspace runtime config home when it has none yet.
 * Copies only credential files (never settings), mode 0600. `conductor runtime login` can replace them later.
 */
export function seedRuntimeCredentials(runtimeId: string, home: string, opts: { force?: boolean } = {}): void {
  const h = process.env.HOME ?? '';
  const candidates: Record<string, Array<[string, string]>> = {
    claude: [[join(h, '.claude', '.credentials.json'), join(home, '.credentials.json')]],
    codex: [[join(h, '.codex', 'auth.json'), join(home, 'auth.json')]],
    gemini: [[join(h, '.gemini', 'oauth_creds.json'), join(home, 'oauth_creds.json')], [join(h, '.gemini', 'google_accounts.json'), join(home, 'google_accounts.json')]],
    opencode: [[join(h, '.local', 'share', 'opencode', 'auth.json'), join(home, 'opencode', 'auth.json')]],
  };
  for (const [src, dst] of candidates[runtimeId] ?? []) {
    try {
      if (!existsSync(src)) continue;
      // Copy when the workspace has no credentials yet, or when the host's file is newer (OAuth tokens rotate; the host CLI refreshes them).
      if (!opts.force && existsSync(dst) && statSync(dst).mtimeMs >= statSync(src).mtimeMs) continue;
      mkdirSync(dirname(dst), { recursive: true });
      copyFileSync(src, dst);
      chmodSync(dst, 0o600);
    } catch { /* best effort */ }
  }
}
