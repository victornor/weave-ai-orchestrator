import type { Db } from '@openconductor/db';
import type { WorkspaceConfig, DaemonConfig } from '@openconductor/shared';
import type { RuntimeAdapter } from '@openconductor/runtime-sdk';
import type { ChannelAdapter } from '@openconductor/channel-sdk';
import type { SurfaceAdapter } from '@openconductor/surface-sdk';
import type { WorktreeProvider, ForgeAdapter, AgentToolDefinition, Logger as PluginLogger } from '@openconductor/plugin-sdk';
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
}
export function workspacePaths(root: string): WorkspacePaths {
  const j = (...p: string[]) => [root, ...p].join('/');
  return { root, state: j('.openconductor'), db: j('.openconductor', 'db.sqlite'), runs: j('.openconductor', 'runs'), conductor: j('conductor'), roles: j('roles'), workers: j('workers'), archive: j('archive', 'workers'), projects: j('projects'), knowledge: j('knowledge'), runtimesHome: j('.openconductor', 'runtimes'), wtConfig: j('.openconductor', 'wt.toml') };
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
  /** Persist the (possibly updated) workspace.yaml. */
  saveConfig(next: WorkspaceConfig): Promise<void>;
}
export type { Logger, PluginLogger };
