import type { Db } from '@weave-ai/db';
import { OcError, type WorkspaceConfig, type DaemonConfig } from '@weave-ai/shared';
import { resolveWorkspaceStateDir, type WorkspaceInstallStatus } from '@weave-ai/release';
import type { RuntimeAdapter } from '@weave-ai/runtime-sdk';
import type { ChannelAdapter } from '@weave-ai/channel-sdk';
import type { SurfaceAdapter } from '@weave-ai/surface-sdk';
import type { WorktreeProvider, ForgeAdapter, Logger as PluginLogger } from '@weave-ai/plugin-sdk';
import type { EventBus } from './events.js';
import type { Logger } from './logger.js';
import type { PluginRegistry } from './plugins/index.js';

/**
 * Registries are process-wide (plugins register once); a WorkspaceContext binds them to one
 * workspace's db and config. This holds only capability-shaped adapters, opt-in *by reference* from
 * a workspace's own config (`models.workers` names a runtime id, `channels.telegram` names a channel
 * kind) — safe to share, since an entry nothing references is simply never used.
 *
 * Agent tools, HTTP routes, and hooks are NOT here (VS-334): a plugin tool is directly callable the
 * moment it's registered, with no such opt-in step, so each workspace needs its own — see
 * `WorkspaceContext.plugins` and `./plugins/index.ts`'s `PluginRegistry`.
 */
export interface Registries {
  runtimes: Map<string, RuntimeAdapter>;
  channels: Map<string, ChannelAdapter>;
  surfaces: Map<string, SurfaceAdapter>;
  worktreeProviders: Map<string, WorktreeProvider>;
  forges: Map<string, ForgeAdapter>;
}
export function createRegistries(): Registries { return { runtimes: new Map(), channels: new Map(), surfaces: new Map(), worktreeProviders: new Map(), forges: new Map() }; }

export interface WorkspacePaths {
  root: string; state: string; db: string; runs: string; weaver: string; roles: string; workers: string; archive: string; projects: string; knowledge: string; runtimesHome: string; wtConfig: string;
  /** VS-92: the encrypted secret values and the key that opens them. Both `0600`, both inside `state`, neither exported nor backed up. */
  secretsFile: string; secretsKey: string;
  /** VS-133: chat message attachments — never under anything `packages/ui`'s dist serves. */
  attachments: string;
}
/**
 * VS-258: the per-workspace state directory (`.agent-conductor/` or `.weave/`) and the conductor
 * agent's home (`conductor/` or `weaver/`) resolve together, from one decision, so a workspace can
 * never end up with mismatched halves — see `resolveWorkspaceStateDir` (`@weave-ai/release`)
 * and this change's design.md Decision 3. An ambiguous installation (both names' `db.sqlite` exist)
 * is a loud `OcError`, never a silent pick.
 */
export function workspacePaths(root: string): WorkspacePaths {
  const j = (...p: string[]) => [root, ...p].join('/');
  let status: WorkspaceInstallStatus;
  let state: string;
  try {
    ({ status, stateDir: state } = resolveWorkspaceStateDir(root));
  } catch (cause) {
    throw new OcError('ambiguous_install_path', (cause as Error).message, { root });
  }
  const js = (...p: string[]) => [state, ...p].join('/');
  return {
    root, state, db: js('db.sqlite'), runs: js('runs'), weaver: j(status === 'old' ? 'conductor' : 'weaver'),
    roles: j('roles'), workers: j('workers'), archive: j('archive', 'workers'), projects: j('projects'), knowledge: j('knowledge'),
    runtimesHome: js('runtimes'), wtConfig: js('wt.toml'), secretsFile: js('secrets.enc'), secretsKey: js('secrets.key'), attachments: js('attachments'),
  };
}

export interface WorkspaceContext {
  workspaceId: string;
  config: WorkspaceConfig;
  daemon: DaemonConfig;
  paths: WorkspacePaths;
  db: Db;
  events: EventBus;
  registries: Registries;
  /** This workspace's own plugin registry — tools, routes, hooks, and load results (VS-334). Never shared with another workspace. */
  plugins: PluginRegistry;
  log: (domain: Parameters<typeof import('./logger.js').getLogger>[0]) => Logger;
  /** Public base URL agents and clients use (loopback listener for run tokens). */
  loopbackUrl: string;
  /** Skills shipped with the package, to be installed into homes. */
  skillsDir: string;
  templatesDir: string;
  /** VS-385: the generated plugin-page stylesheet — `PluginHost.themeCss()`'s value, computed once at daemon startup. */
  v2ThemeCss: string;
  /**
   * VS-143: true when this daemon's own config directory is not the host's plain default (and it
   * was not given the explicit sharing opt-in). An isolated daemon never resolves a runtime
   * credential to the host's file and never dispatches a run nobody asked for. See
   * `daemon-isolation/credential-scope` and `daemon-isolation/dispatch-gate`.
   */
  isolated: boolean;
  /** The daemon's own resolved config directory — where an isolated daemon's own credentials live. */
  daemonConfigDir: string;
  /**
   * VS-542: the fingerprint of the MCP tool list this workspace serves an agent kind. Computed by
   * the server once the workspace's plugins have loaded (core cannot reach the tool registry), so it
   * is optional — a context without one simply skips the session tool-contract check. A session
   * records the fingerprint it started under; a changed one retires it so the new schema reaches the
   * agent on its next turn.
   */
  toolContractHash?: (kind: import('@weave-ai/shared').AgentKind) => string;
  /** Persist the (possibly updated) workspace.yaml. */
  saveConfig(next: WorkspaceConfig): Promise<void>;
}
export type { Logger, PluginLogger };
