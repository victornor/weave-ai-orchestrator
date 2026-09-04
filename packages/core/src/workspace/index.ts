/**
 * Workspace loading: read/validate workspace.yaml, open the db, build WorkspaceContext, ensure layout, registry of workspaces, daemon config.
 * Implemented by the engine module owner; signatures fixed here.
 */
import type { WorkspaceContext, Registries } from '../context.js';
import type { DaemonConfig, WorkspaceConfig, WorkspaceRegistry } from '@openconductor/shared';
export interface LoadOptions { daemon: DaemonConfig; registries: Registries; loopbackUrl: string; skillsDir: string; templatesDir: string; stateDir?: string }
export interface WorkspaceLoader {
  initWorkspace(dir: string, init: { id: string; name: string; ticketPrefix: string }): Promise<WorkspaceConfig>;
  loadWorkspace(dir: string, opts: LoadOptions): Promise<WorkspaceContext>;
  readRegistry(configDir?: string): WorkspaceRegistry;
  writeRegistry(reg: WorkspaceRegistry, configDir?: string): void;
  readDaemonConfig(configDir?: string): DaemonConfig;
  writeDaemonConfig(cfg: DaemonConfig, configDir?: string): void;
  configDir(): string;
}
export { loader as workspaceLoader } from './loader.js';
export { exportWorkspace, stageWorkspaceImport, importTickets, parseTicketFile, exportDirName, type ExportResult, type StageResult, type TicketImportResult } from './portable.js';
