import type { RuntimeAdapter } from '@weave-ai/runtime-sdk';
import type { ChannelAdapter } from '@weave-ai/channel-sdk';
import type { SurfaceAdapter } from '@weave-ai/surface-sdk';
import type { AgentKind, WorkspaceEvent, EventType } from '@weave-ai/shared';
export type { RuntimeAdapter, ChannelAdapter, SurfaceAdapter };

export interface WorktreeInfo { path: string; branch: string; head?: string; dirty?: boolean; ahead?: number; behind?: number; mergeConflicts?: boolean; main?: boolean }
export interface WorktreeProvider {
  readonly id: string;
  detect(): Promise<{ available: boolean; version?: string }>;
  create(input: { repoPath: string; branch: string; base: string; targetPath: string; setupCommand?: string; warmPaths?: string[]; configPath?: string }): Promise<WorktreeInfo>;
  list(repoPath: string, configPath?: string): Promise<WorktreeInfo[]>;
  remove(input: { repoPath: string; path: string; branch: string; deleteBranch: boolean; force: boolean; configPath?: string }): Promise<void>;
}
export interface AgentToolDefinition { name: string; description: string; inputSchema: Record<string, unknown>; scope: AgentKind | 'all'; handler(input: Record<string, unknown>, ctx: { workspaceId: string; agentId: string; agentKind: AgentKind; projectId: string | null; ticketId: string | null; runId: string }): Promise<unknown> }
/** How a pull request's checks stand, rolled up. `none` is "the forge reported no check", not "no answer". */
export type ForgeCheckState = 'pending' | 'success' | 'failure' | 'none';
/**
 * GitHub's `mergeStateStatus`, lowercased (VS-391): whether the pull request can merge as it stands.
 * `clean` is mergeable; `blocked` also covers required checks still running, so it is not on its own
 * a "checks are done" signal. A forge that reports none omits the field.
 */
export type ForgeMergeState = 'behind' | 'blocked' | 'clean' | 'dirty' | 'draft' | 'has_hooks' | 'unknown' | 'unstable';
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
export interface ForgePullRequestDetail extends ForgePullRequest { body: string; files: ForgeChangedFile[]; checkRuns: ForgeCheck[]; /** The pull request's current head commit (VS-452), or null when the forge reports none. */ headSha: string | null }
export interface ForgeAdapter {
  readonly id: string;
  detect(cwd: string): Promise<boolean>;
  prState(cwd: string, url: string): Promise<{ state: 'open' | 'merged' | 'closed'; mergeCommit?: string; ciState?: ForgeCheckState; /** VS-328: the checks that passed out of those reported, when the forge reports any. */ checks?: { passed: number; total: number }; /** VS-481: each reported check by name and state, so a card can name what is pending or failed. */ checkDetails?: ForgeCheck[]; /** VS-365: the pull request's current head commit, when the forge reports one. */ headSha?: string; /** VS-391: whether the pull request can merge as it stands, when the forge reports it. */ mergeState?: ForgeMergeState; /** VS-391: whether the pull request is a draft, when the forge reports it. A draft's absent checks are not "resolved". */ isDraft?: boolean }>;
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
   * Optional (VS-327): opens a pull request from a branch already pushed to the remote. Used by the
   * ticket PR tool (VS-393) and by OpenSpec archive backfill, to land a change left behind by a ticket
   * merged before archiving moved into the merge itself. `draft` asks the forge to open it as a draft
   * (VS-393). A forge that cannot do this simply omits it; the backfill then reports itself unable to
   * open a PR rather than falling back to a direct push.
   */
  createPullRequest?(cwd: string, opts: { branch: string; base: string; title: string; body?: string; draft?: boolean }): Promise<{ url: string; number: number }>;
  /**
   * Optional (VS-393): brings a draft pull request out of draft so its checks start on the head that
   * will land. `changed` is true only when the call actually moved it out of draft, so a caller can
   * tell a run it has just started from one already under way. A pull request that is already out of
   * draft is success with `changed: false`, never an error. A forge that cannot do this simply omits
   * it, and the landing path reads its checks exactly as before.
   */
  markPullRequestReady?(cwd: string, url: string): Promise<{ changed: boolean }>;
  /**
   * Optional (VS-393): whether the repository has any CI workflows configured at all, or `null` when
   * the forge cannot say. `false` lets the landing path treat an absent check rollup as "no CI" and
   * merge as it did before VS-393, rather than waiting for a run that will never come; `true`/`null`
   * means checks are (or may be) coming. A forge that cannot answer omits this, and the landing path
   * falls back to its bounded wait.
   */
  hasCiWorkflows?(cwd: string): Promise<boolean | null>;
  /**
   * Optional (VS-340): the open pull request whose head is `branch`, or `null` when the forge has
   * none. Used by OpenSpec archive backfill to recognise a pull request an earlier attempt opened
   * before it failed, instead of treating the pushed branch itself as proof of a pending pull
   * request and skipping forever.
   */
  pullRequestForBranch?(cwd: string, branch: string): Promise<{ url: string; number: number } | null>;
  /**
   * Optional (VS-770): deletes a branch from the remote repository. A branch that is already gone is
   * success, not an error. The caller owns every safety decision (protected branches, containment);
   * this deletes exactly what it is told to. A forge that cannot do this omits it and cleanup is
   * skipped for that project.
   */
  deleteBranch?(cwd: string, branch: string): Promise<void>;
  /**
   * Optional (VS-359): whether a repository is public, or `null` when the forge cannot say. `cwd` is
   * where the forge runs; the optional `remote` names the repository to inspect and defaults to
   * `cwd`'s own origin — the URL form lets the project-creation form ask before a clone exists, so
   * the switch can warn before a project's knowledge is committed somewhere public. A forge that
   * cannot answer simply omits it, and the caller shows no warning rather than failing.
   */
  repoInfo?(cwd: string, remote?: string): Promise<{ private: boolean } | null>;
  /**
   * Optional (VS-467): whether a `pull_request` workflow run for the pull request's current head is
   * still going to produce a result — either still queued/running, or already concluded success or
   * failure. `false` means an unusable head: no `pull_request` run at all, or only completed runs
   * that concluded `skipped`/`cancelled`/`startup_failure`, which the landing gate can never read as
   * a pass. `null` means the forge cannot say. Used only to decide whether a fresh run must be
   * started; a forge that omits it is waited on as before.
   */
  hasUsableCheckRun?(cwd: string, url: string): Promise<boolean | null>;
  /**
   * Optional (VS-467): the labels served by an online self-hosted runner, or `null` when the forge
   * cannot answer. Used only to explain a stalled landing — a repository whose workflows target a
   * label no online runner serves says so in the alarm. A forge that cannot answer omits it.
   */
  runnerStatus?(cwd: string): Promise<{ onlineLabels: string[] } | null>;
  /**
   * Optional (VS-584): which merge methods the repository allows, or `null` when the forge cannot say.
   * A promotion merges through the repository's rules rather than around them, so it asks before
   * choosing a method; `null` means "unknown", and the caller uses its configured method.
   */
  repoMergeSettings?(cwd: string): Promise<RepoMergeSettings | null>;
}

/** VS-584: the merge methods a repository permits, from its own settings. */
export interface RepoMergeSettings { merge: boolean; squash: boolean; rebase: boolean }
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
  /**
   * The generated stylesheet backing `WEAVE_PLUGIN_CLASS` (VS-385) — V2's real Mono tokens (both
   * themes) plus the vocabulary's component classes, produced from `packages/ui/src/index.css`'s
   * own current text, never a literal this package carries. A plugin rarely needs to call this
   * directly: the bridge already pushes the same string to the page and the client applies it
   * automatically. It exists only for an optional server-rendered first paint, to avoid a flash of
   * unstyled content before that push arrives.
   */
  themeCss(): string;
  config<T = Record<string, unknown>>(): T;
  logger: Logger;
}
export interface WeaveAIPlugin {
  id: string;
  version: string;
  /** A human-readable display name (VS-385) — used as the page title and rail label where present, falling back to `id`. */
  name?: string;
  apiVersion: 1;
  register(host: PluginHost): void | Promise<void>;
}
export function definePlugin(p: WeaveAIPlugin): WeaveAIPlugin { return p; }

/**
 * The plugin page's styling vocabulary (VS-385): class names only, never a colour, spacing or font
 * value — the actual CSS behind them is generated and served by the running daemon (`host.themeCss()`,
 * and the bridge's `stylesheet` push), so restyling the app never requires a plugin rebuild or a new
 * `@weave-ai/plugin-sdk` version. Changing this object's own shape is the only thing that does.
 * `section`/`badge` are the app's own real classes (`.v2-card`/`.v2-tag`); the other five are shared
 * classes added to `packages/ui/src/index.css` alongside real screens that use them. `link` is the
 * anchor role (VS-458): the generated stylesheet also styles a bare `<a>` in a plugin page, so a
 * plugin that writes a plain link is styled too. `rowPanel` (VS-468) is the class for a panel that
 * expands under a `.v2-table` row: place it as a direct child of the table, after the row, and lay
 * out its fields with `.v2-form-row` (the `formRow` role).
 */
export const WEAVE_PLUGIN_CLASS = {
  section: 'v2-card',
  table: 'v2-table',
  badge: 'v2-tag',
  button: 'v2-button',
  input: 'v2-input',
  formRow: 'v2-form-row',
  link: 'v2-link',
  rowPanel: 'v2-table-panel',
} as const;

/**
 * The `.v2-table` recipe's cell roles (VS-385/VS-458/VS-468) — the values a row cell's `data-cell`
 * attribute takes. Separate from `WEAVE_PLUGIN_CLASS` because these are attribute values, not class
 * names, and both constants share the same rule: names only, never a colour, spacing or font value.
 * `actions` is a cell holding a row's own inline controls, laid out for `.v2-button`s — use the
 * compact `data-size="small"` variant so a row's buttons do not set the row's height (VS-458). The
 * `secondary` cell may shrink and truncate with an ellipsis after `primary` keeps a minimum (VS-468),
 * so a long muted detail no longer pushes the actions cell off a narrow row.
 */
export const WEAVE_PLUGIN_TABLE_CELL = {
  primary: 'primary',
  secondary: 'secondary',
  actions: 'actions',
} as const;

/**
 * Vanilla JS (no imports, no bundler) a plugin's own page route inlines in a `<script>` tag before
 * its own script (VS-334). Defines `window.weavePluginClient()`, returning `{ request, onEvent,
 * onTheme }`: `request(method, path, body?)` posts to the parent frame and resolves on the
 * matching reply; `onEvent(kind, handler)` subscribes to this plugin's own live events, forwarded
 * by the host page's postMessage bridge. The page itself can make no other network call — its
 * CSP's `connect-src` is `'none'`; this is the only channel to the daemon.
 *
 * VS-385: calling `weavePluginClient()` also, unconditionally and with no further plugin code,
 * applies the host-pushed stylesheet and theme — injecting a `<style>` element on a `stylesheet`
 * message and setting `documentElement.dataset.theme` on a `theme` message. A plugin written to
 * `WEAVE_PLUGIN_CLASS`'s vocabulary needs nothing else to be fully styled and theme-aware.
 * `onTheme(handler)` is an *additional*, optional subscription for a plugin that wants to react
 * further (e.g. redraw a canvas) — it does not replace the automatic application above.
 */
export const WEAVE_PLUGIN_CLIENT_JS = `
window.weavePluginClient = function weavePluginClient() {
  var pending = Object.create(null);
  var eventHandlers = Object.create(null);
  var themeHandlers = [];
  var nextId = 1;
  var doc = window.document;
  var styleEl = doc.getElementById('weave-plugin-styles');
  if (!styleEl) {
    styleEl = doc.createElement('style');
    styleEl.id = 'weave-plugin-styles';
    doc.head.appendChild(styleEl);
  }
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
    } else if (msg.type === 'stylesheet') {
      styleEl.textContent = msg.css;
    } else if (msg.type === 'theme') {
      doc.documentElement.dataset.theme = msg.theme;
      for (var j = 0; j < themeHandlers.length; j++) themeHandlers[j](msg.theme);
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
    onTheme: function (handler) {
      themeHandlers.push(handler);
    },
  };
};
`;
