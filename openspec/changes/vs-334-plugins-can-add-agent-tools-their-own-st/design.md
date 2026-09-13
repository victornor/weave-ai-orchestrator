## Context

See `proposal.md` - Why for the motivation. Ground truth as of this design (verified against
`origin/main`, file:line references below are current):

- `packages/server/src/daemon.ts:104` creates one `Registries` object for the whole daemon process
  and passes the *same reference* into `loadWorkspaceInto` for every workspace (`daemon.ts:134,242`).
  `packages/core/src/context.ts:11` documents this as deliberate for adapter-shaped registries
  (runtime/channel/surface/forge/worktree-provider): a workspace opts into one *by naming it in its
  own config* (`models.workers`, `channels.telegram`, …), so the registry being global is safe — an
  unreferenced entry is simply never used by that workspace.
- `registerAgentTool` (`daemon.ts:411`) has no such opt-in-by-reference step: whatever lands in
  `registries.agentTools` is directly callable by any agent in any workspace once
  `toolsFor`/`toolNamesFor` are taught to read it. It is also a plain `.push()`, so the same plugin
  loaded for two workspaces double-registers its tool.
- `registerHook` has the equivalent bug one level up: `hooks` (`daemon.ts:105`) is one array shared
  across every `loadWorkspaceInto` call. Each workspace's load loop subscribes *whatever hooks exist
  so far* onto its own `ctx.events` (`daemon.ts:230-234`), then calls `loadPlugins` which may append
  *new* hooks to the same shared array (`daemon.ts:242`) — too late to subscribe onto the workspace
  that just registered them, but in time to leak onto every workspace loaded afterward.
- `toolsFor`/`toolNamesFor` (`packages/server/src/tools.ts:930-938`) are pure functions of agent kind
  only, filtering the static `TOOLS` array against the closed `COMMON_TOOLS`/`WEAVER_TOOLS`/`WORKER_ONLY_TOOLS`
  lists (`packages/shared/src/tools.ts`, marked "Stable API"). There is no workspace parameter and no
  path for a dynamically-registered tool.
- `EventType` (`packages/shared/src/events.ts:2-14`) is a closed literal union; `shared` imports
  nothing from `@weave-ai/*`, so it cannot be made registry-driven the way adapters are — a new event
  kind can only be added by editing `shared` itself, once, in core code.
- `packages/ui/src/router.tsx` and `packages/ui/src/app/nav.ts` are fully static, compiled-in route
  and nav trees; `packages/ui/src/test/workspacenav.test.tsx` pins the derived relationship between
  `RAIL`/`TABS`/`MORE_ITEMS`. There is no precedent for a page or nav entry whose existence depends on
  runtime data.
- The artifact system already solves "render arbitrary self-contained HTML safely, same-origin
  cookies notwithstanding": `packages/server/src/artifact-csp.ts`'s `ARTIFACT_CSP` (a `sandbox`
  directive plus `default-src 'none'`) is set on the raw-HTML route
  (`packages/server/src/routes/artifacts.ts`) and mirrored by the client's own `sandbox` attribute on
  the iframe (`packages/ui/src/components/ArtifactViewer.tsx:156-162`).
- `channels` (`packages/db/src/migrations/0001_init.sql:140`) is the closest existing precedent for
  "one row per (owner, kind), opaque `_json` payload column" — `Db.insert`/`Db.camel`
  (`packages/db/src/db.ts`) already auto-encode/decode any `_json`-suffixed column. There is no
  reserved table-name prefix convention for anything analogous to plugin-owned data.

## Goals / Non-Goals

**Goals:** settle, and build a working proof of, each of the ticket's 8 points, generally — nothing
service-specific. Keep every existing plugin extension point (`registerRuntime`, `registerChannel`,
`registerSurface`, `registerWorktreeProvider`, `registerForge`) and the `echo-channel` example
working unchanged.

**Non-Goals:**
- The Services plugin itself, or anything naming "service", "deployment", or "host:port" in core code.
- Out-of-process plugin isolation (still trusted, in-process code, per the existing README).
- `registerStorage?(provider: LogStorageProvider)` — the PLAN §17 aspiration for a pluggable *run-log*
  storage backend. Unrelated to this ticket's per-plugin *data* store; kept as a distinct, still-unimplemented
  extension point so the two "storage" ideas don't collide in naming or in the docs.
- `PluginHost.config<T>(schema: ZodType<T>)` schema validation (PLAN §17 shows it; today's code has
  `config<T>(): T` with no validation). Not requested by this ticket; left as-is.
- An installer for plugins. Enabling one is still editing `workspace.yaml` or `daemon.yaml` and
  restarting.
- A cross-workspace "which workspaces load plugin X" matrix view. Settings shows, per workspace, that
  workspace's own loaded plugins (workspace-listed and daemon-wide, tagged by source); a daemon-wide
  plugin therefore already appears in every workspace's own list.

## Decisions

### 1. Agent tools: per-workspace registry, namespaced names, additive dispatch

`WorkspaceContext` gains a new field, allocated fresh in `loadWorkspaceInto` before `loadPlugins`
runs for that workspace:

```ts
export interface PluginRuntime {
  id: string; version: string; source: 'workspace' | 'daemon';
  loaded: boolean; error: string | null;
}
export interface PluginRegistry {
  tools: AgentToolDefinition[];
  routes: PluginRouteDef[];
  hooks: Array<{ events: EventType[] | '*'; handler(ev: WorkspaceEvent): Promise<void> }>;
  loaded: PluginRuntime[];
}
```

`WorkspaceContext.plugins: PluginRegistry`. `loadPlugins(ctx, registries, ...)` keeps registering
runtimes/channels/surfaces/forges/worktree-providers into the shared `registries` (unchanged,
Decision reasoning above: safe because opt-in-by-reference), but agent tools, routes, and hooks go
into `ctx.plugins` instead. This is the fix for both the tool-leak and the hook-leak: each workspace
gets its own array, built once per load, never shared.

**Naming and collisions.** `registerAgentTool` requires `tool.name` to match `^<pluginId>_[a-z0-9_]+$`
and rejects (log + skip that tool, plugin keeps loading) a name that collides with any core tool
(`COMMON_TOOLS ∪ WEAVER_TOOLS ∪ WORKER_ONLY_TOOLS`) or an already-registered plugin tool in that
workspace. A `weave_`-prefixed plugin tool name is always rejected — that prefix is reserved for the
"Stable API" core list. `pluginId` itself is validated `^[a-z][a-z0-9-]*$` at plugin load (same
shape OpenSpec/slug identifiers already use elsewhere in this codebase).

**Dispatch.** `toolsFor(kind, ws)`/`toolNamesFor(kind, ws)` gain an optional `ws: WorkspaceRuntime`
parameter; when given, they append `ws.ctx.plugins.tools` filtered by `scope` (`weaver`/`worker`/`all`)
to the static list. `runTool` first checks the static `BY_NAME` map (unchanged, so a plugin can never
override a core handler even if a name slipped through validation); on a miss, it looks in
`ctx.ws.ctx.plugins.tools`, and if found, builds the plugin's own handler context
(`{ workspaceId, agentId, agentKind, projectId, ticketId, runId }`) from `ctx.claims` — the same
fields `AgentToolDefinition.handler` already declares — and wraps the call in the same
try/catch → `ok`/`fail` envelope as every core tool, so a throwing plugin tool fails that one call,
never the run. `mcp.ts`'s `createMcpServer` passes `ctx.ws` through to `toolsFor` so the tool list is
already workspace-correct; no change to the MCP transport itself.

**Alternative considered:** keep `agentTools` in the shared `Registries` but tag each entry with the
workspace id(s) that registered it, and filter at read time. Rejected: it still requires a per-workspace
data structure (a `Map<workspaceId, ...>`) to filter against, so it's the same fix with an extra
layer of indirection and no benefit — `Registries` staying free of anything workspace-shaped is
easier to reason about.

### 2. Hooks: fixed as part of the same restructuring

`registerHook` moves to `ctx.plugins.hooks`, populated during that workspace's `loadPlugins` call.
The subscription loop moves from *before* `loadPlugins` to *after* it, in `loadWorkspaceInto`:

```ts
await loadPlugins(ctx, registries, ctx.plugins);
for (const hook of ctx.plugins.hooks) {
  ctx.events.on((ev) => { if (hook.events !== '*' && !hook.events.includes(ev.type)) return; void hook.handler(ev)... });
}
```

This is not asked for by the ticket text, but it is the same bug class as the tool leak, in code this
change already has to touch to give tools a per-workspace home, and leaving it half-fixed next to the
newly-correct tools/routes/pages would be a landmine for the next person who assumes "plugin
extension points are workspace-scoped" is now uniformly true. Flagged here rather than silently
folded in; captain can ask for it to be split out if preferred.

### 3. Plugin storage: one core-owned document table, not plugin-owned migrations

New migration, `packages/db/src/migrations/0035_plugin_data.sql`:

```sql
CREATE TABLE IF NOT EXISTS plugin_data (
  plugin_id TEXT NOT NULL, key TEXT NOT NULL, value_json TEXT NOT NULL DEFAULT '{}', updated_at TEXT NOT NULL,
  PRIMARY KEY (plugin_id, key)
);
```

`PluginHost.store` (bound to the plugin's own id when the host is built) exposes:

```ts
export interface PluginStore {
  get(key: string): Promise<unknown | null>;
  put(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
  list(prefix?: string): Promise<Array<{ key: string; value: unknown }>>;
}
```

Backed by a small `PluginDataService` in `packages/core` using an upsert (`INSERT ... ON CONFLICT
(plugin_id, key) DO UPDATE ...`) since the composite key doesn't fit `Db.update`'s single-`id`
assumption. `list(prefix)` is a `LIKE` on `key` — the "list all services" shape the Services plugin
needs, keyed however the plugin likes (e.g. `service:<slug>`).

**Removal on uninstall** is a scoped `DELETE FROM plugin_data WHERE plugin_id = ?`, exposed as a new
human-only route and a `weave plugin purge-data <pluginId>` CLI command that calls it over HTTP — the
CLI talks to the daemon only over HTTP (PLAN §4.3) and never opens the workspace database directly,
the same as every other `weave` subcommand. Purging is a deliberate, human-triggered action (the
daemon has no reliable signal that a plugin id present in yesterday's config is "uninstalled" versus
"temporarily commented out"), documented in the guide.

**Revised** (plan review, 2026-09-13): the route is `DELETE /api/w/:ws/plugin-data/:pluginId` — a
sibling top-level workspace route group, deliberately **not** `/api/w/:ws/plugins/:pluginId/data`.
That path would sit inside the plugin's own route prefix from Decision 4, which causes two problems:
a plugin that itself registers `DELETE /data` would collide with it, and — worse — Decision 5's
postMessage bridge is scoped to allow anything under `/api/w/:ws/plugins/<pluginId>/`, so a
compromised plugin *page* could trigger its own data's deletion through the very channel that's
supposed to be limited to what the plugin's own server code already exposes. Mounting it outside that
prefix, in its own route file (`packages/server/src/routes/plugin-data.ts`, `requireOperator`-gated
like the artifact raw-serve route, no run-token access), makes "the bridge can't reach it" a structural
fact of the URL space rather than a rule the bridge's path check has to get right.

**Alternatives considered:**
- *Plugin-owned SQL migrations in a reserved table prefix* (the ticket's other named option): gives a
  plugin a real relational shape instead of a JSON blob, but a plugin is already trusted in-process
  code with a raw handle it could reach into `ctx.db` regardless — a migration system doesn't add
  isolation, it adds a second migration runner to build and version, for no capability the "notes"
  example or a Services-shaped list of records needs. Rejected for v1; the document store's `value_json`
  can hold arbitrarily-shaped records, and nothing stops a future ticket adding a scoped raw-SQL
  escape hatch if a plugin genuinely needs joins or indexes across its own rows.
- *A file on disk per plugin* (like `paths.knowledge`): rejected — loses the `Db` transaction/backup
  story the rest of the workspace's state already has (the whole `db.sqlite` is what backups and
  `daemon upgrade` reason about).

### 4. HTTP routes: one more workspace route group, no new auth

`PluginHost.registerHttpRoute(method, path, handler)`:

```ts
export type PluginHttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
export interface PluginRequestCtx {
  method: PluginHttpMethod; path: string; params: Record<string, string>; query: URLSearchParams;
  headers: Headers; json(): Promise<unknown>; text(): Promise<string>;
  workspaceId: string;
}
export interface PluginRouteDef { pluginId: string; method: PluginHttpMethod; path: string; handler(req: PluginRequestCtx): Promise<Response> | Response }
registerHttpRoute(method: PluginHttpMethod, path: string, handler: PluginRouteDef['handler']): void;
```

`handler` returns a standard Fetch `Response` (plugins already run in the same Node process, so this
costs nothing and needs no new dependency). A new `packages/server/src/routes/plugins.ts` builds one
`Hono` sub-app per request from `ws.ctx.plugins.routes`, matching `pluginId`/`method`/`path` against
the incoming `/api/w/:ws/plugins/:pluginId/*` request and adapting the `Hono` `Context` into a
`PluginRequestCtx`. It is mounted exactly like every other workspace route group
(`ws.route('/plugins', pluginRoutes())` alongside the existing `ws.route('/artifacts', ...)` etc. in
`packages/server/src/app.ts`), so it inherits the existing `app.use('/api/*', authMiddleware(deps))`
session-cookie + CSRF auth with zero new wiring — the same reason `/api/w/:ws/artifacts/:key/raw` is
already auth-gated today. A throwing handler is caught at the mount point and turned into a 500 with
an `OcError`-shaped body; it never reaches the plugin's own process (there is only one process, but
it never crashes the request loop for anyone else).

Route paths are plugin-relative (`/services`, `/services/:id`); the full path a browser or external
caller uses is `/api/w/:ws/plugins/<pluginId>/services/:id`.

### 5. Web page and nav: opaque-origin sandboxed iframe, with a postMessage bridge for data

**Revised** (plan review, 2026-09-13): the first draft of this decision reused `ARTIFACT_CSP`
unmodified and claimed the iframe runs "same origin, so the session cookie is sent." Both are wrong,
and the review caught it against `origin/main`:

- `ARTIFACT_CSP` (`packages/server/src/artifact-csp.ts`) has no `script-src`, so it falls back to
  `default-src 'none'` — **no plugin script would run at all** — and `connect-src 'none'` blocks
  `fetch`/`XHR`/`EventSource` even if a script did run.
- The sandbox has no `allow-same-origin`, so the frame's `Origin` is `null`: the `SameSite=Lax`
  session cookie (`packages/server/src/routes/auth.ts:42`) is never sent, and every mutating route's
  CSRF origin check (`auth.ts:46-90`) rejects the frame's requests anyway.

So the plugin's page could render static markup and nothing else — it could not list services, take a
click, or receive a live update. Fixing this by adding `allow-same-origin` and loosening the CSP was
considered and rejected: a plugin page renders agent- and user-authored data (service names,
statuses, note bodies); a script-injection bug in that page, running same-origin with the viewer's own
session, could call *any* `/api/w/*` route the session is authorized for — approve a merge, answer a
decision — not just the plugin's own. The page must stay a genuinely separate, low-trust context even
though the plugin's *server*-side code (its tool handlers, its route handlers) stays fully trusted,
in-process code as before.

**Chosen: keep the opaque-origin sandbox; add a postMessage bridge in the host page.**

- **Plugin page CSP.** A dedicated constant, not `ARTIFACT_CSP`: `sandbox="allow-scripts allow-forms"`
  (deliberately no `allow-popups`/`allow-downloads` — a plugin page has no legitimate reason to
  navigate the top window or trigger a download) and `connect-src 'none'` still, but with the page's
  own inline script allowed (`script-src 'unsafe-inline'`; a per-response nonce is the fast-follow if
  a plugin ever needs an external `<script src>`, not needed for the toy example). The page can only
  ever reach the daemon through the bridge below — `connect-src 'none'` makes that a CSP-enforced
  fact, not just a convention.
- **Host-side bridge**, in the `/w/$ws/plugins/$pluginId` route component (still the single new
  static route with a dynamic `$pluginId` segment, unchanged from the first draft):
  - listens for `message` events and checks `event.source === iframe.contentWindow` before accepting
    anything — a message from any other window (another tab, another frame) is ignored;
  - accepts `{ id, type: 'request', method, path, body }`; normalises `path` and rejects one that
    escapes `/api/w/:ws/plugins/<pluginId>/` (a leading `..` segment, an absolute URL, a different
    plugin's prefix) without making the call;
  - performs the call with the app's own authenticated `api` client (the same one every other route
    component already uses — it carries the session, not the frame's) and posts back
    `{ id, ok, status, data }` or `{ id, ok: false, error }`;
  - on `{ type: 'subscribe' }`, forwards only `plugin.event` frames from the SSE connection the app
    already holds (`WorkspaceProvider`'s `EventStream`, Decision 7) whose `payload.pluginId` matches
    this route's `pluginId` — no second SSE connection per page.
- **SDK helper.** `packages/plugin-sdk` ships a small browser-side helper, `weavePluginClient()`
  (`request(method, path, body?)` returning a `Promise` of the proxied result; `onEvent(kind, handler)`
  subscribing through the bridge), inlined or imported by a plugin's page script. The `notes` example
  (task 9.2) uses it and `docs/PLUGINS.md` quotes it verbatim.
- **Styling.** The kit CSS is **inlined into the served page** by the plugin's own route handler,
  embedded as a `<style>` block, rather than linked — an opaque-origin frame's `<link>` request cannot
  reliably carry credentials cross-context, and inlining sidesteps that entirely rather than depending
  on it. `docs/PLUGINS.md` shows this exact pattern.
  **Revised** (plan review): the first draft had the plugin's route handler
  `import { ARTIFACT_KIT_CSS } from '@weave-ai/core'` directly — but `@weave-ai/plugin-sdk` (and
  therefore any third-party plugin built against it) may depend on `shared` and the runtime/channel/
  surface SDKs only, never `core` (`scripts/guard-boundaries.mjs`); that import would put every plugin
  one `import` away from the whole daemon's internals. The CSS is exposed as `host.kitCss(): string`
  instead — one more host-bound resource alongside `host.logger`/`host.store`/`host.emit`, resolved by
  `pluginHost()` in `packages/server/src/daemon.ts` (which already may import `core`) and handed to the
  plugin at registration time. `PluginHost`'s own declared type needs no import of `ARTIFACT_KIT_CSS`
  at all — just a method signature — so the boundary is never at risk of being reintroduced by habit.

Trade-off, stated plainly: the plugin's *server* code remains trusted, in-process code, unchanged from
every other extension point in this design — nothing here reduces what a malicious or buggy plugin's
Node code could already do. The bridge exists specifically to bound what a compromised or buggy
plugin **page** (its shipped HTML/JS, potentially rendering untrusted data) can do: at most, the
requests its own server-side routes already accept, through a channel that cannot forge another
plugin's prefix, another origin's session, or a CSRF-bypassing form post.

**Nav** is unchanged from the first draft: `RAIL`/`TABS`/`MORE_ITEMS` (`packages/ui/src/app/nav.ts`)
and their pinned test stay exactly as they are; a separate, runtime-rendered "Plugins" section, driven
by the workspace summary's `plugins` field, lists one link per loaded plugin with a page registered.

**Alternatives considered:**
- *`allow-same-origin` + a loosened CSP* (making the first draft "work" with minimal change): rejected
  above — turns any plugin-page bug into a same-origin session-riding attack against the whole app.
- *Dynamically imported ES module bundle rendered inside the app*: same problem, worse — the plugin's
  JS runs in the app's own JS realm, not just its origin. Rejected for the same reason as the first
  draft's mistake, more so.
- *A declarative page schema (tables/fields/actions the app renders)*: still the safest option and
  needs no bridge at all, but caps every future plugin's UI at anticipated shapes and is real
  product-surface work disproportionate to proving the extension point at toy scale. Rejected for v1;
  nothing here blocks adding it later as a second, opt-in page kind.

### 6. Daemon-wide plugins

`DaemonConfigSchema` gains `plugins: z.array(z.union([z.string(), z.object({ name: z.string(), config: ... })])).default([])`
— the exact shape `WorkspaceConfigSchema.plugins` already has. `loadWorkspaceInto` calls `loadPlugins`
with the concatenation `[...opts.daemon.plugins, ...ctx.config.plugins]` (daemon-wide first, so a
workspace's own list can list the same plugin again harmlessly — `pluginId` collisions inside one
workspace's merged list are rejected the same way a duplicate tool name is, log + skip the second).
Each loaded entry's `PluginRuntime.source` records `'daemon'` or `'workspace'` for the Settings list.
No per-workspace opt-out is added in v1 (not requested; a workspace that truly must not load a
daemon-wide plugin is a config-shape question for a later ticket if it comes up).

### 7. Events

One new closed-enum member: `packages/shared/src/events.ts` `EVENT_TYPES` gains `'plugin.event'`
(additive — every existing switch/consumer that doesn't recognize it already has to tolerate unknown
event types from the same array, so this is not a breaking change to any consumer). `PluginHost.emit(kind:
string, entityId: string, payload: unknown)` calls `ctx.events.emit('plugin.event', \`plugin:${pluginId}\`,
entityId, { pluginId, kind, payload })` — durable, replayed by the existing `/api/w/:ws/events?after=`
SSE route with no transport change. **Revised** (plan review): the page itself cannot open its own
`EventSource` — Decision 5's CSP keeps `connect-src 'none'` in the opaque-origin frame precisely so it
can't. Instead the host page's bridge (Decision 5) subscribes once to the `EventStream` the app
already holds for the workspace, and forwards only the `plugin.event` frames whose `payload.pluginId`
matches the frame it's bridging for, in response to that frame's `{ type: 'subscribe' }` message. No
second SSE connection is opened per plugin page — one connection per workspace, as today, with the
bridge doing the filtering. `weavePluginClient().onEvent(kind, handler)` is the page-side half of this.

### 8. Management (Settings)

The workspace summary route (`GET /api/w/:ws`, `packages/server/src/routes/workspace.ts`) gains a
`plugins: PluginRuntime[]` field, read straight from `ws.ctx.plugins.loaded` (Decision 1's
`PluginRegistry.loaded`, populated once at `loadPlugins` time, success or failure, never mutated
after). `useWorkspaceSummary()` (already fetched by the app) already carries this to the client with
no new request. Settings gets a new `PluginsSection`, following `HostToolsSection`'s existing
read-only list-of-rows pattern (`packages/ui/src/routes/Settings.tsx`): name, id, version, source,
a loaded/failed badge, and the error message when it failed to load.

## Risks / Trade-offs

- [A plugin's own hook now genuinely fires for its own workspace, where before it silently never did]
  → this is a behavior change for any plugin that happens to rely on the current (broken) ordering;
  none exist in this repo (`echo-channel`'s hook test only asserts it fires at all, not on which
  workspace), and the guide documents the corrected, sane behavior going forward.
- [`plugin_data` has no size cap] → not enforced in v1; `value_json` is a `TEXT` column with SQLite's
  ordinary row-size ceiling. Flagged in the guide as "not a substitute for the workspace's own
  large-file storage," not solved here.
- [A plugin route or page handler that never resolves] → no per-request timeout is added; it inherits
  whatever the Hono adaptor's own request handling already does for any slow route today. Not a new
  risk this ticket introduces.
- [Two different plugins choosing the same `pluginId`] → rejected at load (id already present in
  `ctx.plugins.loaded` for that workspace's merged list) exactly like a tool-name collision; the
  second is logged and skipped, never both loaded silently.
- [The bridge's `path` check has a normalisation bug and a plugin page reaches another plugin's route,
  or a route outside `/api/w/:ws/plugins/*` entirely] → the bridge is the whole security boundary once
  the page itself is opaque-origin, so this is the highest-value place for a bug; task 5's tests
  include an explicit "escapes the plugin's own prefix" case (`..`, an absolute URL, another plugin's
  id) alongside the happy path, not just a single success-case test.
- [A malicious page floods the bridge with `request` messages] → not rate-limited in v1; the request
  still goes through the same session-authenticated route as a direct call would, so it is no more
  powerful than a script loop calling the API directly would be through any other tab. Flagged, not
  solved, here.

## Migration Plan

Purely additive: one new migration, one new closed-enum member, one new daemon-config field, new
`PluginHost` methods. No existing table, tool, route, or config field changes shape. `echo-channel`
needs no changes and its existing loading test keeps asserting against `daemon.registries.channels`
unchanged. Rollback is reverting the change; nothing here is a one-way door at the data layer (the
migration only adds a table).

## Open Questions

None that would change the specs, the approach, or the task breakdown — the choices above are the
plan captain is asked to approve or send back with revision comments.
