/**
 * Remote contexts (`~/.config/weave/contexts.yaml`, PLAN §4.4) and workspace resolution.
 * `conductor` is a pure remote client: every command works identically against a local or remote daemon.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { dirname, join, parse as parsePath, resolve } from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { ContextsFileSchema, type ContextsFile } from '@weave-ai/shared';
import { configDir as resolveConfigDir, stateHome as resolveStateHome } from '@weave-ai/release';

export interface ContextEntry { url: string; token: string; workspace?: string; certPin?: string }

export const DEFAULT_URL = 'http://127.0.0.1:7433';

/** VS-258: collapsed into `@weave-ai/release`, the one place old/new resolution happens. */
export function configHome(): string {
  return resolveConfigDir();
}

export function stateHome(): string {
  return resolveStateHome();
}

export function contextsPath(): string {
  return process.env['AC_CONTEXTS_FILE'] ?? join(configHome(), 'contexts.yaml');
}

export function loadContexts(): ContextsFile {
  const path = contextsPath();
  if (!existsSync(path)) return { contexts: {} };
  let raw: unknown;
  try {
    raw = parseYaml(readFileSync(path, 'utf8'));
  } catch (cause) {
    throw new Error(`${path} is not valid YAML: ${(cause as Error).message}`);
  }
  const parsed = ContextsFileSchema.safeParse(raw ?? {});
  if (!parsed.success) throw new Error(`${path} is not a valid contexts file: ${parsed.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`);
  return parsed.data;
}

export function saveContexts(file: ContextsFile): string {
  const path = contextsPath();
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, stringifyYaml(ContextsFileSchema.parse(file)), { mode: 0o600 });
  return path;
}

export function putContext(name: string, entry: ContextEntry, makeCurrent = true): ContextsFile {
  const file = loadContexts();
  file.contexts[name] = entry;
  if (makeCurrent || !file.current) file.current = name;
  saveContexts(file);
  return file;
}

export function removeContext(name: string): boolean {
  const file = loadContexts();
  if (!file.contexts[name]) return false;
  delete file.contexts[name];
  if (file.current === name) file.current = Object.keys(file.contexts)[0];
  saveContexts(file);
  return true;
}

export function useContext(name: string): ContextsFile {
  const file = loadContexts();
  if (!file.contexts[name]) throw new Error(`no such context: ${name}`);
  file.current = name;
  saveContexts(file);
  return file;
}

export interface ResolvedContext { name: string | null; entry: ContextEntry | null }

export function currentContext(explicitName?: string | null): ResolvedContext {
  const file = loadContexts();
  const name = explicitName ?? file.current ?? Object.keys(file.contexts)[0] ?? null;
  if (!name) return { name: null, entry: null };
  const entry = file.contexts[name];
  if (!entry) {
    if (explicitName) throw new Error(`no such context: ${explicitName}`);
    return { name: null, entry: null };
  }
  return { name, entry };
}

/** A context name derived from the url: `conductor.example.com`, `local` for loopback. */
export function suggestContextName(url: string): string {
  try {
    const u = new URL(url);
    if (u.hostname === '127.0.0.1' || u.hostname === 'localhost' || u.hostname === '::1') return 'local';
    return u.hostname;
  } catch {
    return 'default';
  }
}

/** Nearest `workspace.yaml` walking up from `from` (PLAN §5). */
export function findWorkspaceFile(from: string = process.cwd()): string | null {
  let dir = resolve(from);
  const root = parsePath(dir).root;
  for (;;) {
    const candidate = join(dir, 'workspace.yaml');
    try {
      if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
    } catch { /* unreadable directory: keep walking */ }
    if (dir === root) return null;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export function workspaceIdFromFile(path: string): string | null {
  try {
    const doc = parseYaml(readFileSync(path, 'utf8')) as { id?: unknown } | null;
    return typeof doc?.id === 'string' && doc.id ? doc.id : null;
  } catch {
    return null;
  }
}

/** `--workspace` > `AC_WORKSPACE` > context default > nearest `workspace.yaml`. */
export function resolveWorkspaceId(explicit?: string | null, context?: ContextEntry | null, cwd: string = process.cwd()): string | null {
  if (explicit) return explicit;
  const env = process.env['AC_WORKSPACE'];
  if (env) return env;
  if (context?.workspace) return context.workspace;
  const file = findWorkspaceFile(cwd);
  return file ? workspaceIdFromFile(file) : null;
}
