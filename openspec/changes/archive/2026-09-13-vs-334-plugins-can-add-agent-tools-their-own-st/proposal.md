## Why

A plugin today can register a runtime, channel, surface, worktree provider, forge or hook and have
it actually work. `registerAgentTool` cannot: nothing ever reads `registries.agentTools`, so a
plugin tool is registered and then never reaches an agent, contradicting `examples/plugins/README.md`.
A plugin also has no storage, no way to serve an HTTP route, and no way to add a page or nav entry.
Captain wants to build a **Services** plugin, in its own repository, that adds a page to every
workspace and lets agents create/fetch/update services through tools. This ticket builds and proves
the four missing extension points general-purpose; the Services plugin itself is a separate,
later repository.

## What Changes

- **Agent tools work.** A plugin-registered tool appears in the MCP tool list (and the CLI's
  `POST /api/w/:ws/agent/tools/:tool`) for the agent kinds and workspaces that actually load the
  plugin, runs through the same `ToolResult` envelope as core tools, and is namespaced
  `<pluginId>_<name>` so it can never shadow a `weave_*` core tool; a name collision is rejected at
  load, logged, and skips only that tool.
- **BREAKING (internal only, no external API change):** plugin agent-tool registration moves off
  the process-wide `Registries` object onto a new per-workspace `WorkspaceContext.plugins` registry.
  Today `registries.agentTools` is one array shared by every loaded workspace — a tool a plugin
  registers while loading for workspace A silently becomes callable from workspace B too, with no
  attribution and no dedup. This must be fixed before agent tools can honestly be described as
  scoped to "the workspaces that load the plugin."
- **The same shared-array bug is fixed for `registerHook`.** `hooks` is today one array closed over
  by every workspace; a hook a plugin registers while loading workspace A also fires on every
  workspace loaded *after* A, and never fires on A's own events (subscription happens before that
  workspace's own plugins have registered). Hooks move into the same per-workspace registry as
  tools/routes/pages, fixing both defects as a side effect of the restructuring this ticket already
  requires. `registerRuntime`/`registerChannel`/`registerSurface`/`registerForge`/`registerWorktreeProvider`
  keep the process-wide registry: they are opt-in-by-reference (a workspace's own config names a
  runtime/channel by id), not opt-in-by-registration, so a global registry is safe for them.
- **Plugin data storage.** A new `plugin_data` table (migration, reserved to plugin use, core code
  never reads or writes it) gives each plugin a namespaced JSON document store — `get`/`put`/`delete`/`list`
  by key — reached through `PluginHost.store`. Durable, isolated per plugin id, and removable with one
  scoped delete.
- **Plugin HTTP routes.** `PluginHost.registerHttpRoute(method, path, handler)` mounts under
  `/api/w/:ws/plugins/<pluginId>/...`, inside the existing workspace route group, so it gets the
  same session-cookie auth as every other `/api/w/:ws/*` route for free. No run-token access in v1.
- **A web page and nav entry.** A plugin serves its page as one more HTTP route returning
  self-contained HTML; the web app iframes it at a single new static route
  (`/w/:ws/plugins/:pluginId`) in an **opaque-origin** sandbox (no `allow-same-origin`, a dedicated
  CSP, not the artifact one — that CSP blocks scripts and network entirely and the sandbox's real
  origin would ride the viewer's session). The host page runs a `postMessage` bridge that proxies a
  scoped, path-checked subset of `/api/w/:ws/plugins/<pluginId>/*` requests and forwards only that
  plugin's live events — `packages/plugin-sdk` ships a small `weavePluginClient()` browser helper for
  a plugin page to call through it. A workspace's loaded plugins (from its bootstrap response) drive a
  runtime-rendered "Plugins" nav section — the existing static `RAIL`/`TABS`/`MORE_ITEMS` arrays, and
  their pinned test, are untouched.
- **Daemon-wide plugins.** `plugins:` is added to `daemon.yaml` (`DaemonConfigSchema`), applied to
  every workspace in addition to that workspace's own `plugins:` list, so captain's Services plugin
  reaches every workspace without editing each `workspace.yaml`.
- **Plugin events.** One new closed-enum member, `plugin.event`, lets `PluginHost.emit(kind, entityId, payload)`
  put a durable, per-workspace event on the existing outbox/SSE stream. Since a plugin's page cannot
  open its own connection (its CSP forbids it), the host page's bridge subscribes to the workspace's
  existing stream once and forwards only that plugin's events through — no new transport, no second
  connection per page.
- **Management.** Settings shows loaded plugins (name, id, version, source — workspace or daemon —
  loaded, and its load error), sourced from load results the daemon already captures when it tries
  each plugin. Install/remove stays "edit config, restart" — this ticket does not add an installer.
- **SDK, docs and example.** `packages/plugin-sdk` gains the new `PluginHost` methods, additively —
  `apiVersion` stays `1`, `examples/plugins/echo-channel` keeps loading unchanged. A new "notes"
  example plugin at toy scale exercises all four new extension points. `docs/PLAN.md` §17 is
  rewritten to the settled contract.
- **Documentation (added to scope 2026-09-13 by captain).** A dedicated **Plugins** section in the
  top-level `README.md`; a complete plugin-authoring guide (new `docs/PLUGINS.md`) covering every
  `PluginHost` method's contract, linked from `PLAN.md` §17 and from the README; a project knowledge
  document (`weave_knowledge_doc_put`, slug `plugins`) covering where loading happens, how
  registries are scoped, how plugin tools join the MCP list, where storage/routes live, and the
  landmines found while building this. Every code example in the README and the guide is verified
  against the shipped SDK types and the example plugin's actual source, not hand-typed prose.

## Capabilities

### New Capabilities
- `plugins/agent-tools`: plugin-registered MCP tools — naming, scope, per-workspace visibility, the error envelope, collision rejection.
- `plugins/storage`: the per-plugin, per-workspace document store.
- `plugins/http-routes`: plugin-mounted HTTP routes, their path and their auth.
- `plugins/web-pages`: the plugin page route, its sandboxed rendering, and the workspace nav entry.
- `plugins/events`: the `plugin.event` type and how a plugin emits and a page consumes it.
- `plugins/lifecycle`: daemon-wide + per-workspace enabling, per-workspace registry scoping (tools and hooks), load failure containment, API versioning, and the Settings management list.

### Modified Capabilities
(none — every change here is additive to existing behavior; no existing requirement's behavior changes)

## Impact

- `packages/plugin-sdk/src/index.ts` — `PluginHost` gains `registerHttpRoute`, `store`, `emit`, `kitCss()`; types for the new request/store shapes; a browser-side `weavePluginClient()` export for a plugin page to import. No new `@weave-ai/*` import added to this package — `kitCss()` is a method signature only, resolved daemon-side.
- `packages/core/src/context.ts` — new `WorkspaceContext.plugins` per-workspace registry (tools, hooks, routes, page, load results); `Registries` loses `agentTools`.
- `packages/server/src/daemon.ts` — `loadPlugins`/`pluginHost` rewritten to bind the new per-workspace registry instead of the shared one; daemon-wide `plugins:` merged in before a workspace's own list.
- `packages/server/src/tools.ts`, `packages/server/src/mcp.ts` — `toolsFor`/`toolNamesFor`/`runTool` merge in a workspace's plugin tools, scope- and collision-checked.
- `packages/server/src/routes/` — new `pluginRoutes()` mounted at `ws.route('/plugins', ...)`; a separate `plugin-data.ts` route group mounted at `ws.route('/plugin-data', ...)` for the operator-only purge endpoint, outside the plugin's own (bridge-reachable) prefix; workspace summary route gains a `plugins` field.
- `packages/server/src/plugin-page-csp.ts` (new, alongside the existing `artifact-csp.ts`) — the dedicated, more restrictive CSP for a plugin's page response.
- `packages/db/src/migrations/0035_plugin_data.sql` — new table.
- `packages/shared/src/events.ts` — `plugin.event` added to `EVENT_TYPES`.
- `packages/shared/src/config.ts` — `plugins` added to `DaemonConfigSchema`.
- `packages/ui/src/router.tsx`, `packages/ui/src/app/nav.ts` (or a new nav module), `packages/ui/src/routes/Settings.tsx` — one new static route with its host-side postMessage bridge, a runtime-rendered nav section, a Settings section.
- `packages/cli/` — new `weave plugin purge-data <pluginId>` command calling the new route.
- `examples/plugins/notes/` — new example plugin.
- `examples/plugins/echo-channel/` — unchanged; existing loading test keeps passing.
- `README.md`, `docs/PLUGINS.md` (new), `docs/PLAN.md` §17 — documentation.
- Project knowledge base — new `plugins` document.
