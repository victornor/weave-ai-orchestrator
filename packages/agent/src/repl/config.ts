import { existsSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, parse as parsePath, resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { McpServersSchema, ProviderProfileSchema, type McpServer, type ProviderProfile } from '@weave-ai/shared';
import { openDaemonSecret, openWorkspaceSecret } from './secrets.js';

/**
 * VS-631: a provider in the user's own `agent.yaml` may carry a literal `apiKey` (or a `${NAME}`/
 * `{env:NAME}` reference to the environment), opencode-style, so `weave repl` works from any directory
 * with no workspace. The shared `ProviderProfileSchema` stays key-free, so a workspace's `workspace.yaml`
 * — which may be committed or shared — can never hold one.
 */
export type ReplProviderProfile = ProviderProfile & { apiKey?: string };

export type ReplPermission = 'auto' | 'restricted' | 'bypass';
export const REPL_PERMISSIONS: readonly ReplPermission[] = ['auto', 'restricted', 'bypass'];
/** A person at a terminal gets the mode a worker gets: every core tool, confined file tools, no approval prompts. */
export const DEFAULT_PERMISSION: ReplPermission = 'auto';

export interface ReplFlags { provider?: string; baseUrl?: string; model?: string; preset?: string; permission?: string; workspaceDir?: string }
export interface WorkspaceRef { file: string; root: string; stateDir: string }
export interface ReplConfig {
  providers: Record<string, ReplProviderProfile>;
  mcpServers: Record<string, McpServer>;
  /** Provider, model and mode the session starts with; null when nothing names one. */
  provider: string | null;
  model: string | null;
  permission: ReplPermission;
  workspace: WorkspaceRef | null;
  /** VS-633: the daemon's config directory when it holds a `daemon.yaml`, whose providers and MCP servers sit under every other source; its secret store is read for keys. */
  daemonDir: string | null;
  /** Where each thing was read from, for `--verbose` and the startup line. Never a secret. */
  sources: string[];
  /** Problems found while reading (a bad file is skipped, not fatal). */
  notes: string[];
  /** VS-631: the one-line reason a config-file provider was skipped, by id. Never contains a field's value. */
  providerErrors: Record<string, string>;
  /** VS-631: plaintext-credential warnings (a readable `agent.yaml`), printed once and never refused. */
  warnings: string[];
  /** The user's `agent.yaml` when it exists, for the warning and the first-run how-to. */
  userConfigFile: string | null;
}

export const isPermission = (v: unknown): v is ReplPermission => typeof v === 'string' && (REPL_PERMISSIONS as readonly string[]).includes(v);

/** `WEAVE_LLM_<PROVIDER>_KEY`: the provider id upper-cased, dashes to underscores. */
export const keyVarFor = (providerId: string): string => `WEAVE_LLM_${providerId.toUpperCase().replace(/[^A-Z0-9]/g, '_')}_KEY`;

/** The user's config file: `$XDG_CONFIG_HOME/weave/agent.yaml`, else `~/.config/weave/agent.yaml`. */
export function agentConfigPath(env: NodeJS.ProcessEnv = process.env, home: string = homedir()): string {
  return join(env['XDG_CONFIG_HOME'] || join(home, '.config'), 'weave', 'agent.yaml');
}

/**
 * VS-633: the daemon's config directory, found the way the daemon and the CLI find it (`AC_CONFIG_HOME`, else
 * `$XDG_CONFIG_HOME` or `~/.config` with `weave`, or `agent-conductor` on a host installed before the rename).
 * The daemon need not be running: only its files are read.
 */
export function daemonConfigDir(env: NodeJS.ProcessEnv = process.env, home: string = homedir()): string {
  if (env['AC_CONFIG_HOME']) return env['AC_CONFIG_HOME'];
  const base = env['XDG_CONFIG_HOME']?.trim() ? env['XDG_CONFIG_HOME'] : join(home, '.config');
  const legacy = join(base, 'agent-conductor');
  return existsSync(join(base, 'weave')) || !existsSync(legacy) ? join(base, 'weave') : legacy;
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

/** The secret-name a key should live under, named in a skip reason without ever echoing a value. */
const keyNameFor = (id: string): string => keyVarFor(id);

const stringList = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

/** A one-line reason for a skipped provider, built from the field path and never from a field's value. */
function skipReason(issues: ReadonlyArray<{ path: ReadonlyArray<string | number> }>, id: string): string {
  const field = issues[0]?.path.join('.') ?? '';
  if (field === 'apiKeySecret') return `apiKeySecret must be a secret name such as ${keyNameFor(id)}, not the key itself`;
  if (field === 'baseUrl') return 'baseUrl must be a valid URL';
  return field ? `${field} is not valid` : 'the profile is not valid';
}

interface ProvidersFromOptions {
  /** The user's own `agent.yaml` may set a literal `apiKey`; a `workspace.yaml` may not. */
  allowApiKey: boolean;
  /** Per-provider skip reasons, keyed by id, assigned on a failure. */
  errors: Record<string, string>;
}

function providersFrom(raw: unknown, from: string, notes: string[], o: ProvidersFromOptions): Record<string, ReplProviderProfile> {
  const out: Record<string, ReplProviderProfile> = {};
  if (typeof raw !== 'object' || raw === null) return out;
  for (const [id, p] of Object.entries(raw)) {
    if (!/^[a-z][a-z0-9-]*$/.test(id)) { notes.push(`${from}: provider "${id}" is not a kebab-case id`); continue; }
    const obj = (typeof p === 'object' && p !== null ? p : {}) as Record<string, unknown>;
    const hasApiKey = Object.prototype.hasOwnProperty.call(obj, 'apiKey');
    if (hasApiKey && !o.allowApiKey) {
      o.errors[id] = `provider "${id}" in ${from} sets apiKey, which is only allowed in the user's own agent.yaml; use apiKeySecret or the environment instead`;
      continue;
    }
    if (hasApiKey && !(typeof obj['apiKey'] === 'string' && obj['apiKey'].length > 0)) {
      o.errors[id] = `provider "${id}" in ${from} was skipped: apiKey must be a non-empty string or a \${NAME} reference`;
      continue;
    }
    const parsed = ProviderProfileSchema.safeParse(p);
    if (!parsed.success) { o.errors[id] = `provider "${id}" in ${from} was skipped: ${skipReason(parsed.error.issues, id)}`; continue; }
    out[id] = hasApiKey ? { ...parsed.data, apiKey: obj['apiKey'] as string } : parsed.data;
  }
  return out;
}

/**
 * VS-631: a one-line warning when the user's own `agent.yaml` is readable by group or others and holds
 * a plaintext credential — a literal `apiKey`, or an `apiKeySecret` that is not a secret name. The value
 * is never included. A private file (0600) warns anyway? No: no warning.
 */
export function readableConfigWarning(file: string, providers: unknown): string | null {
  let mode: number;
  try { mode = statSync(file).mode; } catch { return null; }
  if ((mode & 0o077) === 0 || typeof providers !== 'object' || providers === null) return null;
  const octal = (mode & 0o777).toString(8);
  for (const p of Object.values(providers as Record<string, unknown>)) {
    if (typeof p !== 'object' || p === null) continue;
    const obj = p as Record<string, unknown>;
    const apiKey = obj['apiKey'];
    const secret = obj['apiKeySecret'];
    const plaintext = (typeof apiKey === 'string' && apiKey.length > 0) || (typeof secret === 'string' && secret.length > 0 && !/^[A-Z][A-Z0-9_]*$/.test(secret));
    if (plaintext) return `warning: ${file} is readable by other users (mode ${octal}) and holds a plaintext credential; run \`chmod 600 ${file}\``;
  }
  return null;
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
 * Where things come from, lowest to highest: the daemon's `daemon.yaml` (VS-633), the user's `agent.yaml`,
 * then the command line. VS-654: providers are daemon-only, so the nearest workspace contributes
 * `mcpServers` only — a `providers`/`disabledProviders` block there is ignored. An MCP server entry with
 * the same name replaces the whole entry; a daemon server the workspace lists in `disabledMcpServers`
 * (and does not define itself) is dropped. Reading these is reading files: the daemon is never
 * contacted. A file that does not parse is a note, not a failure, so a broken config still lets `-p` run.
 */
export function loadReplConfig(i: LoadInput): ReplConfig {
  const notes: string[] = [];
  const sources: string[] = [];
  const providerErrors: Record<string, string> = {};
  const warnings: string[] = [];
  let userConfigFile: string | null = null;
  let providers: Record<string, ReplProviderProfile> = {};
  let mcpServers: Record<string, McpServer> = {};
  let provider: string | null = null;
  let model: string | null = null;
  let permission: ReplPermission = DEFAULT_PERMISSION;

  let daemonDir: string | null = null;
  const daemonFile = join(daemonConfigDir(i.env, i.home), 'daemon.yaml');
  let daemonProviders: Record<string, ReplProviderProfile> = {};
  let daemonMcp: Record<string, McpServer> = {};
  if (existsSync(daemonFile)) {
    const doc = readYaml(daemonFile, notes);
    if (doc) {
      daemonDir = dirname(daemonFile);
      sources.push(`daemon ${daemonFile}`);
      // A daemon.yaml, like a workspace.yaml, is never the place for a literal key.
      daemonProviders = providersFrom(doc['providers'], daemonFile, notes, { allowApiKey: false, errors: providerErrors });
      daemonMcp = mcpFrom(doc['mcpServers'], daemonFile, notes);
      providers = { ...daemonProviders };
      mcpServers = { ...daemonMcp };
    }
  }

  const userFile = agentConfigPath(i.env, i.home);
  if (existsSync(userFile)) {
    userConfigFile = userFile;
    const doc = readYaml(userFile, notes);
    if (doc) {
      sources.push(`user config ${userFile}`);
      providers = { ...providers, ...providersFrom(doc['providers'], userFile, notes, { allowApiKey: true, errors: providerErrors }) };
      mcpServers = { ...mcpServers, ...mcpFrom(doc['mcpServers'], userFile, notes) };
      if (typeof doc['provider'] === 'string') provider = doc['provider'];
      if (typeof doc['model'] === 'string') model = doc['model'];
      if (isPermission(doc['permission'])) permission = doc['permission'];
      const warning = readableConfigWarning(userFile, doc['providers']);
      if (warning) warnings.push(warning);
    }
  }

  let workspace: WorkspaceRef | null = null;
  const wsFile = i.flags.workspaceDir ? join(resolve(i.cwd, i.flags.workspaceDir), 'workspace.yaml') : findWorkspaceFile(i.cwd);
  if (wsFile && existsSync(wsFile)) {
    const doc = readYaml(wsFile, notes);
    if (doc) {
      workspace = workspaceRef(wsFile);
      sources.push(`workspace ${wsFile}`);
      // VS-654: providers are daemon-only; a workspace `providers`/`disabledProviders` block is
      // ignored. The workspace layer remains for MCP servers only.
      const wsMcp = mcpFrom(doc['mcpServers'], wsFile, notes);
      for (const name of stringList(doc['disabledMcpServers'])) if (!(name in wsMcp) && name in daemonMcp && mcpServers[name] === daemonMcp[name]) delete mcpServers[name];
      mcpServers = { ...mcpServers, ...wsMcp };
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

  return { providers, mcpServers, provider, model, permission, workspace, daemonDir, sources, notes, providerErrors, warnings, userConfigFile };
}

export type KeySource = 'config' | 'env' | 'workspace' | 'daemon' | 'none';
export interface ResolvedKey { key: string | undefined; source: KeySource; /** The variable or secret name that was looked up; safe to print. */ name: string }

/** A `${NAME}` or `{env:NAME}` reference to an environment variable. */
const KEY_REF = /^\$\{([A-Za-z_][A-Za-z0-9_]*)\}$|^\{env:([A-Za-z_][A-Za-z0-9_]*)\}$/;

/** The profile's own `apiKey`: a literal, or a `${NAME}`/`{env:NAME}` reference read from the environment. */
export function resolveApiKeyRef(value: string, env: NodeJS.ProcessEnv): { key: string | undefined; name: string } {
  const m = KEY_REF.exec(value.trim());
  if (!m) return { key: value, name: 'apiKey' };
  const name = (m[1] ?? m[2])!;
  return { key: env[name], name };
}

/**
 * The provider's key, first hit wins: the profile's own `apiKey` (a literal, or a `${NAME}` reference
 * read from the environment — VS-631, user `agent.yaml` only), then the environment under `apiKeySecret`
 * or `WEAVE_LLM_<PROVIDER>_KEY`, then the daemon's secret store (VS-633). VS-654: a workspace secret
 * store no longer contributes a provider key. `workspace` stays on the input for the MCP resolver.
 */
export function resolveApiKey(o: { providerId: string; profile: ReplProviderProfile; env: NodeJS.ProcessEnv; workspace: WorkspaceRef | null; daemonDir?: string | null }): ResolvedKey {
  let unresolved: string | undefined;
  if (o.profile.apiKey) {
    const ref = resolveApiKeyRef(o.profile.apiKey, o.env);
    if (ref.key) return { key: ref.key, source: 'config', name: ref.name };
    unresolved = ref.name;
  }
  const names = [...new Set([o.profile.apiKeySecret, keyVarFor(o.providerId)].filter((n): n is string => !!n))];
  for (const n of names) { const v = o.env[n]; if (v) return { key: v, source: 'env', name: n }; }
  if (o.daemonDir) for (const n of names) { const v = openDaemonSecret(o.daemonDir, n); if (v) return { key: v, source: 'daemon', name: n }; }
  return { key: undefined, source: 'none', name: unresolved ?? names[0] ?? keyVarFor(o.providerId) };
}

const REF = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g;
/** A `${NAME}` reference in an MCP server's headers or env resolves from the environment, then the workspace store; an unresolved one is reported and left empty. */
export function resolveMcpRefs(server: McpServer, o: { env: NodeJS.ProcessEnv; workspace: WorkspaceRef | null; daemonDir?: string | null }): { server: McpServer; missing: string[] } {
  const missing: string[] = [];
  const sub = (v: string): string => v.replace(REF, (_m, name: string) => {
    const got = o.env[name] ?? (o.workspace ? openWorkspaceSecret(o.workspace.stateDir, name) : null) ?? (o.daemonDir ? openDaemonSecret(o.daemonDir, name) : null);
    if (got === null || got === undefined) { missing.push(name); return ''; }
    return got;
  });
  const map = (r: Record<string, string>): Record<string, string> => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, sub(v)]));
  return { server: { ...server, headers: map(server.headers), env: map(server.env) }, missing };
}
