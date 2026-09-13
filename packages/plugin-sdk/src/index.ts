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
  prState(cwd: string, url: string): Promise<{ state: 'open' | 'merged' | 'closed'; mergeCommit?: string; ciState?: ForgeCheckState; /** VS-328: the checks that passed out of those reported, when the forge reports any. */ checks?: { passed: number; total: number } }>;
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
  /**
   * Optional (VS-327): opens a pull request from a branch already pushed to the remote. Used only by
   * OpenSpec archive backfill, to land a change left behind by a ticket merged before archiving moved
   * into the merge itself — never for a ticket's own PR, which a worker still opens with `gh pr create`.
   * A forge that cannot do this simply omits it; the backfill then reports itself unable to open a PR
   * rather than falling back to a direct push.
   */
  createPullRequest?(cwd: string, opts: { branch: string; base: string; title: string; body?: string }): Promise<{ url: string; number: number }>;
  /**
   * Optional (VS-340): the open pull request whose head is `branch`, or `null` when the forge has
   * none. Used by OpenSpec archive backfill to recognise a pull request an earlier attempt opened
   * before it failed, instead of treating the pushed branch itself as proof of a pending pull
   * request and skipping forever.
   */
  pullRequestForBranch?(cwd: string, branch: string): Promise<{ url: string; number: number } | null>;
}
export interface Logger { debug(msg: string, data?: Record<string, unknown>): void; info(msg: string, data?: Record<string, unknown>): void; warn(msg: string, data?: Record<string, unknown>): void; error(msg: string, data?: Record<string, unknown>): void }
/** A plugin's own namespaced, durable document store (VS-334). One value per key, JSON-shaped. */
export interface PluginStore {
  get(key: string): Promise<unknown | null>;
  put(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
  list(prefix?: string): Promise<Array<{ key: string; value: unknown }>>;
}
export type PluginHttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
/** What a plugin's HTTP route handler receives — a minimal, stable request shape, not a raw framework `Context` (VS-334). */
export interface PluginRequestCtx {
  method: PluginHttpMethod;
  path: string;
  params: Record<string, string>;
  query: URLSearchParams;
  headers: Headers;
  json(): Promise<unknown>;
  text(): Promise<string>;
  workspaceId: string;
}
export type PluginRouteHandler = (req: PluginRequestCtx) => Promise<Response> | Response;
export interface PluginHost {
  registerRuntime(adapter: RuntimeAdapter): void;
  registerChannel(adapter: ChannelAdapter): void;
  registerSurface(adapter: SurfaceAdapter): void;
  registerWorktreeProvider(provider: WorktreeProvider): void;
  registerForge(adapter: ForgeAdapter): void;
  registerHook(sub: { events: EventType[] | '*'; handler(ev: WorkspaceEvent): Promise<void> }): void;
  registerAgentTool(tool: AgentToolDefinition): void;
  /**
   * Mounts `handler` at `/api/w/:ws/plugins/<pluginId><path>`, behind the same session auth as every
   * other workspace route (VS-334). `path` is relative to the plugin's own prefix — it can never
   * escape it, and the operator-only plugin-data purge route deliberately lives outside this prefix
   * entirely so a plugin's own page (reached only through the postMessage bridge scoped to this same
   * prefix) can never trigger it.
   */
  registerHttpRoute(method: PluginHttpMethod, path: string, handler: PluginRouteHandler): void;
  /** This plugin's own namespaced document store (VS-334) — isolated per plugin, never a core table. */
  store: PluginStore;
  /** Puts a `plugin.event` on this workspace's existing event stream, tagged with this plugin's id (VS-334). */
  emit(kind: string, entityId: string, payload: unknown): void;
  /** The Artifact Kit CSS, for a plugin's page to inline into a `<style>` block (VS-334) — a method, not a static import, so `@weave-ai/plugin-sdk` never has to depend on `@weave-ai/core` to expose it. */
  kitCss(): string;
  config<T = Record<string, unknown>>(): T;
  logger: Logger;
}
export interface WeaveAIPlugin { id: string; version: string; apiVersion: 1; register(host: PluginHost): void | Promise<void> }
export function definePlugin(p: WeaveAIPlugin): WeaveAIPlugin { return p; }

/**
 * Vanilla JS (no imports, no bundler) a plugin's own page route inlines in a `<script>` tag before
 * its own script (VS-334). Defines `window.weavePluginClient()`, returning `{ request, onEvent }`:
 * `request(method, path, body?)` posts to the parent frame and resolves on the matching reply;
 * `onEvent(kind, handler)` subscribes to this plugin's own live events, forwarded by the host page's
 * postMessage bridge. The page itself can make no other network call — its CSP's `connect-src`
 * is `'none'`; this is the only channel to the daemon.
 */
export const WEAVE_PLUGIN_CLIENT_JS = `
window.weavePluginClient = function weavePluginClient() {
  var pending = Object.create(null);
  var eventHandlers = Object.create(null);
  var nextId = 1;
  window.addEventListener('message', function (event) {
    var msg = event.data;
    if (!msg || typeof msg !== 'object') return;
    if (msg.type === 'response' && pending[msg.id]) {
      var p = pending[msg.id];
      delete pending[msg.id];
      if (msg.ok) p.resolve({ status: msg.status, data: msg.data });
      else p.reject(msg.error);
    } else if (msg.type === 'event') {
      var handlers = eventHandlers[msg.kind];
      if (handlers) for (var i = 0; i < handlers.length; i++) handlers[i](msg.payload);
    }
  });
  return {
    request: function (method, path, body) {
      return new Promise(function (resolve, reject) {
        var id = String(nextId++);
        pending[id] = { resolve: resolve, reject: reject };
        window.parent.postMessage({ type: 'request', id: id, method: method, path: path, body: body }, '*');
      });
    },
    onEvent: function (kind, handler) {
      if (!eventHandlers[kind]) eventHandlers[kind] = [];
      eventHandlers[kind].push(handler);
      window.parent.postMessage({ type: 'subscribe', kind: kind }, '*');
    },
  };
};
`;
