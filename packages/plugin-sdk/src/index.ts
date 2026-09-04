import type { RuntimeAdapter } from '@agent-conductor/runtime-sdk';
import type { ChannelAdapter } from '@agent-conductor/channel-sdk';
import type { SurfaceAdapter } from '@agent-conductor/surface-sdk';
import type { WorkspaceEvent, EventType } from '@agent-conductor/shared';
export type { RuntimeAdapter, ChannelAdapter, SurfaceAdapter };

export interface WorktreeInfo { path: string; branch: string; head?: string; dirty?: boolean; ahead?: number; behind?: number; mergeConflicts?: boolean; main?: boolean }
export interface WorktreeProvider {
  readonly id: string;
  detect(): Promise<{ available: boolean; version?: string }>;
  create(input: { repoPath: string; branch: string; base: string; targetPath: string; setupCommand?: string; warmPaths?: string[]; configPath?: string }): Promise<WorktreeInfo>;
  list(repoPath: string, configPath?: string): Promise<WorktreeInfo[]>;
  remove(input: { repoPath: string; path: string; branch: string; deleteBranch: boolean; force: boolean; configPath?: string }): Promise<void>;
}
export interface AgentToolDefinition { name: string; description: string; inputSchema: Record<string, unknown>; scope: 'conductor' | 'worker' | 'all'; handler(input: Record<string, unknown>, ctx: { workspaceId: string; agentId: string; agentKind: 'conductor' | 'worker'; projectId: string | null; ticketId: string | null; runId: string }): Promise<unknown> }
export interface ForgeAdapter { readonly id: string; detect(cwd: string): Promise<boolean>; prState(cwd: string, url: string): Promise<{ state: 'open' | 'merged' | 'closed'; mergeCommit?: string; ciState?: 'pending' | 'success' | 'failure' | 'none' }>; mergePr(cwd: string, url: string, method: string): Promise<{ mergeCommit?: string }> }
export interface Logger { debug(msg: string, data?: Record<string, unknown>): void; info(msg: string, data?: Record<string, unknown>): void; warn(msg: string, data?: Record<string, unknown>): void; error(msg: string, data?: Record<string, unknown>): void }
export interface PluginHost {
  registerRuntime(adapter: RuntimeAdapter): void;
  registerChannel(adapter: ChannelAdapter): void;
  registerSurface(adapter: SurfaceAdapter): void;
  registerWorktreeProvider(provider: WorktreeProvider): void;
  registerForge(adapter: ForgeAdapter): void;
  registerHook(sub: { events: EventType[] | '*'; handler(ev: WorkspaceEvent): Promise<void> }): void;
  registerAgentTool(tool: AgentToolDefinition): void;
  config<T = Record<string, unknown>>(): T;
  logger: Logger;
}
export interface AgentConductorPlugin { id: string; version: string; apiVersion: 1; register(host: PluginHost): void | Promise<void> }
export function definePlugin(p: AgentConductorPlugin): AgentConductorPlugin { return p; }
