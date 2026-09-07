import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, chmodSync, lstatSync, readlinkSync, rmSync, symlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import YAML from 'yaml';
import { openDb, newId, nowIso } from '@agent-conductor/db';
import {
  DaemonConfigSchema, DEFAULT_KNOWLEDGE_BUDGETS, WorkspaceConfigSchema, WorkspaceRegistrySchema, OcError,
  type DaemonConfig, type KnowledgeBudgets, type WorkspaceConfig, type WorkspaceRegistry,
} from '@agent-conductor/shared';
import type { Registries, WorkspaceContext } from '../context.js';
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
    for (const id of runtimeIds) {
      if (!id) continue;
      mkdirSync(join(paths.runtimesHome, id), { recursive: true });
      linkRuntimeCredentials(id, join(paths.runtimesHome, id), { readCredential: credentialReaderFor(opts.registries, id) });
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
 * The one credential per runtime per host (VS-75).
 *
 * The workspace's runtime config home holds a *symlink* to the credential file the machine owner's
 * own CLI reads and writes, never a copy of it. Claude's OAuth rotates the refresh token on every
 * refresh, so two live copies race and whichever refreshes first invalidates the other; the outage
 * of 2026-09-07 was exactly that. Only the credential file is shared — settings, session history
 * and project state stay per workspace, so `CLAUDE_CONFIG_DIR` still points here.
 */

/** Host path -> workspace path, per runtime. The host path is always the canonical one. */
function credentialPaths(runtimeId: string, home: string): Array<[string, string]> {
  const h = process.env.HOME ?? '';
  const candidates: Record<string, Array<[string, string]>> = {
    claude: [[join(h, '.claude', '.credentials.json'), join(home, '.credentials.json')]],
    codex: [[join(h, '.codex', 'auth.json'), join(home, 'auth.json')]],
    gemini: [[join(h, '.gemini', 'oauth_creds.json'), join(home, 'oauth_creds.json')], [join(h, '.gemini', 'google_accounts.json'), join(home, 'google_accounts.json')]],
    opencode: [[join(h, '.local', 'share', 'opencode', 'auth.json'), join(home, 'opencode', 'auth.json')]],
  };
  return candidates[runtimeId] ?? [];
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
export function linkRuntimeCredentials(runtimeId: string, home: string, opts: { readCredential?: CredentialReader } = {}): void {
  for (const [src, dst] of credentialPaths(runtimeId, home)) {
    try { reconcileOne(src, dst, opts.readCredential); } catch { /* best effort */ }
  }
}

/** Alias kept for the reconcile call sites, which read as a repair rather than a first link. */
export const reconcileRuntimeCredential = linkRuntimeCredentials;
