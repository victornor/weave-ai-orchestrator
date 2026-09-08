import type { Db } from '@agent-conductor/db';
import type { WorkspaceConfig, DaemonConfig } from '@agent-conductor/shared';
import type { RuntimeAdapter } from '@agent-conductor/runtime-sdk';
import type { ChannelAdapter } from '@agent-conductor/channel-sdk';
import type { SurfaceAdapter } from '@agent-conductor/surface-sdk';
import type { WorktreeProvider, ForgeAdapter, AgentToolDefinition, Logger as PluginLogger } from '@agent-conductor/plugin-sdk';
import type { EventBus } from './events.js';
import type { Logger } from './logger.js';

/** Registries are process-wide (plugins register once); a WorkspaceContext binds them to one workspace's db and config. */
export interface Registries {
  runtimes: Map<string, RuntimeAdapter>;
  channels: Map<string, ChannelAdapter>;
  surfaces: Map<string, SurfaceAdapter>;
  worktreeProviders: Map<string, WorktreeProvider>;
  forges: Map<string, ForgeAdapter>;
  agentTools: AgentToolDefinition[];
}
export function createRegistries(): Registries { return { runtimes: new Map(), channels: new Map(), surfaces: new Map(), worktreeProviders: new Map(), forges: new Map(), agentTools: [] }; }

export interface WorkspacePaths {
  root: string; state: string; db: string; runs: string; conductor: string; roles: string; workers: string; archive: string; projects: string; knowledge: string; runtimesHome: string; wtConfig: string;
  /** VS-92: the encrypted secret values and the key that opens them. Both `0600`, both inside `state`, neither exported nor backed up. */
  secretsFile: string; secretsKey: string;
  /** VS-133: chat message attachments — never under anything `packages/ui`'s dist serves. */
  attachments: string;
}
export function workspacePaths(root: string): WorkspacePaths {
  const j = (...p: string[]) => [root, ...p].join('/');
  return { root, state: j('.agent-conductor'), db: j('.agent-conductor', 'db.sqlite'), runs: j('.agent-conductor', 'runs'), conductor: j('conductor'), roles: j('roles'), workers: j('workers'), archive: j('archive', 'workers'), projects: j('projects'), knowledge: j('knowledge'), runtimesHome: j('.agent-conductor', 'runtimes'), wtConfig: j('.agent-conductor', 'wt.toml'), secretsFile: j('.agent-conductor', 'secrets.enc'), secretsKey: j('.agent-conductor', 'secrets.key'), attachments: j('.agent-conductor', 'attachments') };
}

export interface WorkspaceContext {
  workspaceId: string;
  config: WorkspaceConfig;
  daemon: DaemonConfig;
  paths: WorkspacePaths;
  db: Db;
  events: EventBus;
  registries: Registries;
  log: (domain: Parameters<typeof import('./logger.js').getLogger>[0]) => Logger;
  /** Public base URL agents and clients use (loopback listener for run tokens). */
  loopbackUrl: string;
  /** Skills shipped with the package, to be installed into homes. */
  skillsDir: string;
  templatesDir: string;
  /**
   * VS-143: true when this daemon's own config directory is not the host's plain default (and it
   * was not given the explicit sharing opt-in). An isolated daemon never resolves a runtime
   * credential to the host's file and never dispatches a run nobody asked for. See
   * `daemon-isolation/credential-scope` and `daemon-isolation/dispatch-gate`.
   */
  isolated: boolean;
  /** The daemon's own resolved config directory — where an isolated daemon's own credentials live. */
  daemonConfigDir: string;
  /** Persist the (possibly updated) workspace.yaml. */
  saveConfig(next: WorkspaceConfig): Promise<void>;
}
export type { Logger, PluginLogger };
