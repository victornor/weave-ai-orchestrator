import { existsSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, parse as parsePath, resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { McpServersSchema, ProviderProfileSchema, type McpServer, type ProviderProfile } from '@weave-ai/shared';
import { openWorkspaceSecret } from './secrets.js';

export type ReplPermission = 'auto' | 'restricted' | 'bypass';
export const REPL_PERMISSIONS: readonly ReplPermission[] = ['auto', 'restricted', 'bypass'];
/** A person at a terminal gets the mode a worker gets: every core tool, confined file tools, no approval prompts. */
export const DEFAULT_PERMISSION: ReplPermission = 'auto';

export interface ReplFlags { provider?: string; baseUrl?: string; model?: string; preset?: string; permission?: string; workspaceDir?: string }
export interface WorkspaceRef { file: string; root: string; stateDir: string }
export interface ReplConfig {
  providers: Record<string, ProviderProfile>;
  mcpServers: Record<string, McpServer>;
  /** Provider, model and mode the session starts with; null when nothing names one. */
  provider: string | null;
  model: string | null;
  permission: ReplPermission;
  workspace: WorkspaceRef | null;
  /** Where each thing was read from, for `--verbose` and the startup line. Never a secret. */
  sources: string[];
  /** Problems found while reading (a bad file is skipped, not fatal). */
  notes: string[];
}

export const isPermission = (v: unknown): v is ReplPermission => typeof v === 'string' && (REPL_PERMISSIONS as readonly string[]).includes(v);

/** `WEAVE_LLM_<PROVIDER>_KEY`: the provider id upper-cased, dashes to underscores. */
export const keyVarFor = (providerId: string): string => `WEAVE_LLM_${providerId.toUpperCase().replace(/[^A-Z0-9]/g, '_')}_KEY`;

/** The user's config file: `$XDG_CONFIG_HOME/weave/agent.yaml`, else `~/.config/weave/agent.yaml`. */
export function agentConfigPath(env: NodeJS.ProcessEnv = process.env, home: string = homedir()): string {
  return join(env['XDG_CONFIG_HOME'] || join(home, '.config'), 'weave', 'agent.yaml');
}

/** The nearest `workspace.yaml` at or above `from`, or null. */
export function findWorkspaceFile(from: string): string | null {
  let dir = resolve(from);
  const root = parsePath(dir).root;
  for (;;) {
    const candidate = join(dir, 'workspace.yaml');
    try { if (existsSync(candidate) && statSync(candidate).isFile()) return candidate; } catch { /* unreadable: keep walking */ }
    const parent = dirname(dir);
    if (dir === root || parent === dir) return null;
    dir = parent;
  }
}

/** The workspace's state directory: `.weave`, or `.agent-conductor` on a host installed before the rename. */
export function workspaceRef(file: string): WorkspaceRef {
  const root = dirname(file);
  const stateDir = existsSync(join(root, '.weave', 'db.sqlite')) || !existsSync(join(root, '.agent-conductor', 'db.sqlite')) ? join(root, '.weave') : join(root, '.agent-conductor');
  return { file, root, stateDir };
}

function readYaml(path: string, notes: string[]): Record<string, unknown> | null {
  try {
    const doc: unknown = parseYaml(readFileSync(path, 'utf8'));
    return typeof doc === 'object' && doc !== null && !Array.isArray(doc) ? doc as Record<string, unknown> : null;
  } catch (e) { notes.push(`${path}: ${(e as Error).message}`); return null; }
}

function providersFrom(raw: unknown, from: string, notes: string[]): Record<string, ProviderProfile> {
  const out: Record<string, ProviderProfile> = {};
  if (typeof raw !== 'object' || raw === null) return out;
  for (const [id, p] of Object.entries(raw)) {
    if (!/^[a-z][a-z0-9-]*$/.test(id)) { notes.push(`${from}: provider "${id}" is not a kebab-case id`); continue; }
    const parsed = ProviderProfileSchema.safeParse(p);
    if (parsed.success) out[id] = parsed.data; else notes.push(`${from}: provider "${id}": ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
  }
  return out;
}

function mcpFrom(raw: unknown, from: string, notes: string[]): Record<string, McpServer> {
  if (raw === undefined || raw === null) return {};
  const parsed = McpServersSchema.safeParse(raw);
  if (parsed.success) return parsed.data;
  notes.push(`${from}: mcpServers: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
  return {};
}

export interface LoadInput { flags: ReplFlags; env: NodeJS.ProcessEnv; cwd: string; home?: string }

/**
 * Where things come from, lowest to highest: the user's `agent.yaml`, the nearest workspace's `providers`
 * and `mcpServers`, then the command line. Reading a workspace is reading its files: the daemon is never
 * contacted. A file that does not parse is a note, not a failure, so a broken config still lets `-p` run.
 */
export function loadReplConfig(i: LoadInput): ReplConfig {
  const notes: string[] = [];
  const sources: string[] = [];
  let providers: Record<string, ProviderProfile> = {};
  let mcpServers: Record<string, McpServer> = {};
  let provider: string | null = null;
  let model: string | null = null;
  let permission: ReplPermission = DEFAULT_PERMISSION;

  const userFile = agentConfigPath(i.env, i.home);
  if (existsSync(userFile)) {
    const doc = readYaml(userFile, notes);
    if (doc) {
      sources.push(`user config ${userFile}`);
      providers = { ...providers, ...providersFrom(doc['providers'], userFile, notes) };
      mcpServers = { ...mcpServers, ...mcpFrom(doc['mcpServers'], userFile, notes) };
      if (typeof doc['provider'] === 'string') provider = doc['provider'];
      if (typeof doc['model'] === 'string') model = doc['model'];
      if (isPermission(doc['permission'])) permission = doc['permission'];
    }
  }

  let workspace: WorkspaceRef | null = null;
  const wsFile = i.flags.workspaceDir ? join(resolve(i.cwd, i.flags.workspaceDir), 'workspace.yaml') : findWorkspaceFile(i.cwd);
  if (wsFile && existsSync(wsFile)) {
    const doc = readYaml(wsFile, notes);
    if (doc) {
      workspace = workspaceRef(wsFile);
      sources.push(`workspace ${wsFile}`);
      providers = { ...providers, ...providersFrom(doc['providers'], wsFile, notes) };
      mcpServers = { ...mcpServers, ...mcpFrom(doc['mcpServers'], wsFile, notes) };
    }
  } else if (i.flags.workspaceDir) notes.push(`no workspace.yaml in ${resolve(i.cwd, i.flags.workspaceDir)}`);

  if (i.flags.baseUrl) {
    const id = i.flags.provider ?? 'custom';
    if (!/^[a-z][a-z0-9-]*$/.test(id)) notes.push(`--provider "${id}" is not a kebab-case id`);
    else {
      const parsed = ProviderProfileSchema.safeParse({ baseUrl: i.flags.baseUrl, ...(i.flags.preset ? { preset: i.flags.preset } : {}), auth: i.env[keyVarFor(id)] ? 'bearer' : 'none', apiKeySecret: keyVarFor(id) });
      if (parsed.success) { providers[id] = { ...parsed.data, ...(providers[id] ? { models: providers[id]!.models } : {}) }; sources.push('command line provider'); }
      else notes.push(`--base-url: ${parsed.error.issues.map((x) => x.message).join('; ')}`);
    }
    provider = id;
  } else if (i.flags.provider) provider = i.flags.provider;
  if (!provider) { const ids = Object.keys(providers); if (ids.length === 1) provider = ids[0]!; }
  if (i.flags.model) {
    // `provider/model` names both; a bare model keeps the chosen provider.
    const slash = i.flags.model.indexOf('/');
    const head = slash > 0 ? i.flags.model.slice(0, slash) : '';
    if (head && providers[head]) { provider = head; model = i.flags.model.slice(slash + 1); }
    else model = i.flags.model;
  }
  if (i.flags.permission !== undefined) { if (isPermission(i.flags.permission)) permission = i.flags.permission; else notes.push(`--permission "${i.flags.permission}" is not one of ${REPL_PERMISSIONS.join(', ')}`); }
  if (provider && providers[provider] && !model) model = Object.keys(providers[provider]!.models)[0] ?? null;

  return { providers, mcpServers, provider, model, permission, workspace, sources, notes };
}

export type KeySource = 'env' | 'workspace' | 'none';
export interface ResolvedKey { key: string | undefined; source: KeySource; /** The variable or secret name that was looked up; safe to print. */ name: string }

/** The provider's key: environment (`apiKeySecret` name, then `WEAVE_LLM_<PROVIDER>_KEY`), else the workspace secret store on disk. */
export function resolveApiKey(o: { providerId: string; profile: ProviderProfile; env: NodeJS.ProcessEnv; workspace: WorkspaceRef | null }): ResolvedKey {
  const names = [...new Set([o.profile.apiKeySecret, keyVarFor(o.providerId)].filter((n): n is string => !!n))];
  for (const n of names) { const v = o.env[n]; if (v) return { key: v, source: 'env', name: n }; }
  if (o.workspace) for (const n of names) { const v = openWorkspaceSecret(o.workspace.stateDir, n); if (v) return { key: v, source: 'workspace', name: n }; }
  return { key: undefined, source: 'none', name: names[0] ?? keyVarFor(o.providerId) };
}

const REF = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g;
/** A `${NAME}` reference in an MCP server's headers or env resolves from the environment, then the workspace store; an unresolved one is reported and left empty. */
export function resolveMcpRefs(server: McpServer, o: { env: NodeJS.ProcessEnv; workspace: WorkspaceRef | null }): { server: McpServer; missing: string[] } {
  const missing: string[] = [];
  const sub = (v: string): string => v.replace(REF, (_m, name: string) => {
    const got = o.env[name] ?? (o.workspace ? openWorkspaceSecret(o.workspace.stateDir, name) : null);
    if (got === null || got === undefined) { missing.push(name); return ''; }
    return got;
  });
  const map = (r: Record<string, string>): Record<string, string> => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, sub(v)]));
  return { server: { ...server, headers: map(server.headers), env: map(server.env) }, missing };
}
