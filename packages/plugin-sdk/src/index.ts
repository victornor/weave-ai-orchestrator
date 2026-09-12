import type { RuntimeAdapter } from '@weave-ai/runtime-sdk';
import type { ChannelAdapter } from '@weave-ai/channel-sdk';
import type { SurfaceAdapter } from '@weave-ai/surface-sdk';
import type { WorkspaceEvent, EventType } from '@weave-ai/shared';
export type { RuntimeAdapter, ChannelAdapter, SurfaceAdapter };

export interface WorktreeInfo { path: string; branch: string; head?: string; dirty?: boolean; ahead?: number; behind?: number; mergeConflicts?: boolean; main?: boolean }
export interface WorktreeProvider {
  readonly id: string;
  detect(): Promise<{ available: boolean; version?: string }>;
  create(input: { repoPath: string; branch: string; base: string; targetPath: string; setupCommand?: string; warmPaths?: string[]; configPath?: string }): Promise<WorktreeInfo>;
  list(repoPath: string, configPath?: string): Promise<WorktreeInfo[]>;
  remove(input: { repoPath: string; path: string; branch: string; deleteBranch: boolean; force: boolean; configPath?: string }): Promise<void>;
}
export interface AgentToolDefinition { name: string; description: string; inputSchema: Record<string, unknown>; scope: 'weaver' | 'worker' | 'all'; handler(input: Record<string, unknown>, ctx: { workspaceId: string; agentId: string; agentKind: 'weaver' | 'worker'; projectId: string | null; ticketId: string | null; runId: string }): Promise<unknown> }
/** How a pull request's checks stand, rolled up. `none` is "the forge reported no check", not "no answer". */
export type ForgeCheckState = 'pending' | 'success' | 'failure' | 'none';
/** One changed file with the lines it adds and removes. */
export interface ForgeChangedFile { path: string; additions: number; deletions: number }
/** One check, named, for a pull request's detail. The rolled-up `ForgeCheckState` is what a list shows. */
export interface ForgeCheck { name: string; state: ForgeCheckState; url: string | null }
/** One pull request as a forge lists it: everything a list entry shows, without a second request. */
export interface ForgePullRequest {
  number: number; title: string; url: string; author: string | null;
  state: 'open' | 'merged' | 'closed'; isDraft: boolean;
  headRefName: string; baseRefName: string;
  createdAt: string; updatedAt: string; mergedAt: string | null; closedAt: string | null;
  additions: number; deletions: number; changedFiles: number;
  checks: ForgeCheckState;
  /** Whatever the forge calls its review verdict, lowercased; null when it reports none. */
  reviewDecision: string | null;
  mergeCommit: string | null;
}
/** One pull request read in full: its description, what it changes, and each check by name. */
export interface ForgePullRequestDetail extends ForgePullRequest { body: string; files: ForgeChangedFile[]; checkRuns: ForgeCheck[] }
export interface ForgeAdapter {
  readonly id: string;
  detect(cwd: string): Promise<boolean>;
  prState(cwd: string, url: string): Promise<{ state: 'open' | 'merged' | 'closed'; mergeCommit?: string; ciState?: ForgeCheckState }>;
  mergePr(cwd: string, url: string, method: string): Promise<{ mergeCommit?: string }>;
  /**
   * Optional (VS-97): the repository's pull requests, most recently updated first, open and closed
   * alike — the caller windows and groups them. A forge that cannot list simply omits both of these,
   * and the pull-request view reports itself unavailable rather than broken.
   */
  listPullRequests?(cwd: string, opts?: { limit?: number }): Promise<ForgePullRequest[]>;
  /** Optional (VS-97): one pull request with its description, its changed files and its checks. */
  pullRequest?(cwd: string, number: number): Promise<ForgePullRequestDetail | null>;
  /**
   * Optional (VS-107): one pull request's unified diff, in the same text format `git diff` produces
   * — the daemon's own clone-diff fallback and this are parsed by the same code. `null` when the
   * forge has no such pull request.
   */
  pullRequestDiff?(cwd: string, number: number): Promise<string | null>;
}
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
export interface WeaveAIPlugin { id: string; version: string; apiVersion: 1; register(host: PluginHost): void | Promise<void> }
export function definePlugin(p: WeaveAIPlugin): WeaveAIPlugin { return p; }
