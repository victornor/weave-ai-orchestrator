/**
 * Workspace loading: read/validate workspace.yaml, open the db, build WorkspaceContext, ensure layout, registry of workspaces, daemon config.
 * Implemented by the engine module owner; signatures fixed here.
 */
import type { WorkspaceContext, Registries } from '../context.js';
import type { DaemonConfig, WorkspaceConfig, WorkspaceRegistry } from '@weave-ai/shared';
export interface LoadOptions {
  daemon: DaemonConfig; registries: Registries; loopbackUrl: string; skillsDir: string; templatesDir: string; stateDir?: string;
  /** VS-143: the daemon's own resolved config directory and whether it is isolated from the host. See `daemon-isolation`. */
  daemonConfigDir: string; isolated: boolean;
}
export interface WorkspaceLoader {
  initWorkspace(dir: string, init: { id: string; name: string; ticketPrefix: string }): Promise<WorkspaceConfig>;
  loadWorkspace(dir: string, opts: LoadOptions): Promise<WorkspaceContext>;
  readRegistry(configDir?: string): WorkspaceRegistry;
  writeRegistry(reg: WorkspaceRegistry, configDir?: string): void;
  readDaemonConfig(configDir?: string): DaemonConfig;
  writeDaemonConfig(cfg: DaemonConfig, configDir?: string): void;
  /**
   * First-boot seed (VS-236): when `daemon.yaml` is missing, write it with the three unconfigured
   * worker tiers and return that config. An existing file is read unchanged.
   */
  ensureFreshDaemonConfig(configDir?: string): DaemonConfig;
  configDir(): string;
  /** VS-143: whether `resolved` is the host's one conventional config directory (see `daemon-isolation`). */
  isDefaultConfigDir(resolved: string): boolean;
}
export { loader as workspaceLoader } from './loader.js';
export { exportWorkspace, stageWorkspaceImport, importTickets, parseTicketFile, exportDirName, type ExportResult, type StageResult, type TicketImportResult } from './portable.js';
