/** Turns global flags + environment + contexts file into a ready `ApiClient`. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AC_ENV } from '@agent-conductor/shared';
import { ApiClient, ApiError } from './api.js';
import { configHome, currentContext, resolveWorkspaceId, DEFAULT_URL, type ContextEntry } from './contexts.js';
import { applyCertPin } from './tls.js';

export interface GlobalOptions {
  workspace?: string;
  json?: boolean;
  color?: boolean;
  context?: string;
  url?: string;
  token?: string;
}

export interface Session {
  client: ApiClient;
  contextName: string | null;
  url: string;
  /** True when authenticating with `AC_RUN_TOKEN` (an agent inside a run, PLAN §9.5). */
  agent: boolean;
}

export interface ResolveOptions {
  /** Resolve (and require) a workspace id. Daemon-level commands pass false. */
  workspace?: 'required' | 'optional' | 'none';
  /** Skip the contexts file entirely (used by `conductor login`). */
  anonymous?: boolean;
}

let pinApplied = false;

export async function resolveSession(options: GlobalOptions, resolveOptions: ResolveOptions = {}): Promise<Session> {
  const runToken = process.env[AC_ENV.RUN_TOKEN] ?? null;
  const wantWorkspace = resolveOptions.workspace ?? 'required';

  let url: string;
  let token: string | null = null;
  let contextName: string | null = null;
  let entry: ContextEntry | null = null;

  if (runToken) {
    url = options.url ?? process.env[AC_ENV.API_URL] ?? DEFAULT_URL;
  } else if (options.url) {
    url = options.url;
    token = options.token ?? process.env['AC_TOKEN'] ?? null;
  } else {
    const ctx = resolveOptions.anonymous ? { name: null, entry: null } : currentContext(options.context ?? null);
    contextName = ctx.name;
    entry = ctx.entry;
    url = entry?.url ?? process.env[AC_ENV.API_URL] ?? localDaemonUrl() ?? DEFAULT_URL;
    token = options.token ?? process.env['AC_TOKEN'] ?? entry?.token ?? null;
  }

  if (entry?.certPin && !pinApplied) {
    await applyCertPin(url, entry.certPin);
    pinApplied = true;
  }

  const workspaceId = wantWorkspace === 'none'
    ? null
    : resolveWorkspaceId(options.workspace ?? null, entry, process.cwd()) ?? (runToken ? process.env[AC_ENV.WORKSPACE_ID] ?? null : null);

  const client = new ApiClient({ baseUrl: url, token, runToken, workspace: workspaceId });

  if (wantWorkspace === 'required' && !client.workspace) {
    const only = await soleWorkspace(client);
    if (only) client.workspace = only;
    else {
      throw new ApiError('validation', 'no workspace selected: pass --workspace <id>, set AC_WORKSPACE, or run inside a workspace directory', 400);
    }
  }

  return { client, contextName, url, agent: client.isAgent };
}

/** When the daemon serves exactly one workspace, using it is never ambiguous. */
async function soleWorkspace(client: ApiClient): Promise<string | null> {
  try {
    const health = await client.get<{ workspaces?: Array<{ id?: string }> }>('/api/health');
    const list = Array.isArray(health?.workspaces) ? health.workspaces : [];
    return list.length === 1 && typeof list[0]?.id === 'string' ? list[0]!.id! : null;
  } catch {
    return null;
  }
}

/**
 * No context, no `--url`: talk to the daemon started on this machine over its loopback listener
 * (`daemon.json`), which is what makes `conductor daemon set-password` and `conductor daemon status` work before
 * the first login — and while the public listener is held for lack of an operator password.
 */
function localDaemonUrl(): string | null {
  try {
    const j = JSON.parse(readFileSync(join(configHome(), 'daemon.json'), 'utf8')) as { pid?: number; loopbackUrl?: string };
    if (!j.pid || !j.loopbackUrl || !j.loopbackUrl.startsWith('http://')) return null;
    process.kill(j.pid, 0);
    return j.loopbackUrl;
  } catch {
    return null;
  }
}
