# Writing a Weave AI plugin

The settled contract behind `docs/PLAN.md` §17 (VS-334). If this guide and the plan disagree, the
plan wins — file the difference as a bug in this doc. Every code sample below is quoted from, or
type-checked against, the shipped `@weave-ai/plugin-sdk` types and `examples/plugins/notes/index.js`
— never hand-typed prose that might drift from what actually ships.

## The shape of a plugin

```js
import { definePlugin } from '@weave-ai/plugin-sdk';

export default definePlugin({
  id: 'notes',
  version: '0.1.0',
  apiVersion: 1,
  register(host) {
    // host.registerAgentTool(...), host.registerHttpRoute(...), host.store, host.emit(...), ...
  },
});
```

Plain JavaScript, no build step, no TypeScript required — `examples/plugins/echo-channel` and
`examples/plugins/notes` are both hand-written `.js` files with a `package.json` whose `main` (or
`exports`) points at them. A directory works the same way listed under `plugins:` in
`workspace.yaml` (that workspace only) or `daemon.yaml` (every workspace this daemon serves, merged
in before that workspace's own list — how one plugin like a Services page reaches every workspace
without editing each one's config). A relative path resolves against the workspace root; an
absolute path is taken as is; a bare name resolves from `node_modules` (the workspace's own first).
Restart the daemon after changing `plugins:` — plugins register once, at load.

## Trust model

Plugins are **trusted, in-process code** — there is no sandbox around a plugin's own server-side
`register()` function, its tool handlers, or its route handlers. They run with the same privileges
as the daemon itself. That trust never extends to a plugin's *page* (see below): its shipped
HTML/JS may render agent- or user-authored data, so it runs in a genuinely separate, low-trust
browser context regardless of how trusted the plugin's own code is.

`PluginHost` simply does not expose the APIs that would let a plugin override a core invariant:
there is no way to bypass ticket checkout/transition guards, approval ownership, the auto-merge
gate, or the project boundary from plugin code. A plugin extends the surface; it cannot rewrite the
rules underneath it.

A plugin that throws — at load, in a tool call, in a route handler — is logged and contained to
that one plugin or that one call. It never stops the daemon, another plugin, or another request.

## `PluginHost`, method by method

### Agent tools

```ts
registerAgentTool(tool: AgentToolDefinition): void;
```

```ts
export interface AgentToolDefinition {
  name: string; description: string; inputSchema: Record<string, unknown>;
  scope: 'weaver' | 'worker' | 'all';
  handler(input: Record<string, unknown>, ctx: {
    workspaceId: string; agentId: string; agentKind: 'weaver' | 'worker';
    projectId: string | null; ticketId: string | null; runId: string;
  }): Promise<unknown>;
}
```

**Naming.** `tool.name` must match `<pluginId>_<name>` — for plugin id `notes`, `notes_create` is
valid, `weave_ticket_get` and `create_note` are both rejected. A name colliding with a core `weave_*`
tool, or with another plugin's tool already registered in the same workspace, is rejected at load
(logged, skipped — the rest of that plugin's `register()` still runs). The `weave_` prefix is
reserved for the core "Stable API" tool list; a plugin tool can never shadow it.

**Scope** decides which agent kinds see the tool in their MCP `tools/list` and can call it:
`'weaver'`, `'worker'`, or `'all'`. It is enforced the same way a core tool's availability is — a
call from the wrong kind gets `{ ok: false, error: { code: 'forbidden', ... } }`.

**Visibility is per workspace.** A tool a plugin registers while loading for workspace `acme` is
callable only in `acme` (and any other workspace that also loads that same plugin) — never in a
workspace that doesn't load it, regardless of load order.

**The error envelope** is the same `ToolResult` every core tool returns: a handler's return value
becomes `{ ok: true, data }`; a thrown error becomes `{ ok: false, error: { code, message,
retryable } }` without crashing the calling agent's run.

From `examples/plugins/notes/index.js`:

```js
host.registerAgentTool({
  name: 'notes_create',
  description: 'Add a note the notes page will show.',
  inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
  scope: 'all',
  handler: async (input) => create(String(input.text)),
});
```

### Storage

```ts
store: PluginStore;
```

```ts
export interface PluginStore {
  get(key: string): Promise<unknown | null>;
  put(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
  list(prefix?: string): Promise<Array<{ key: string; value: unknown }>>;
}
```

A namespaced JSON document store, one per plugin, backed by the `plugin_data` table in the
workspace's own database — durable across restarts, isolated per plugin id (two plugins storing
under the same key never see each other's value), and never a core table. `list(prefix)` is a
`LIKE`-prefix scan, the shape a "list every X this plugin owns" call needs:

```js
const create = (text) => {
  const id = newNoteId();
  const note = { id, text, createdAt: new Date().toISOString() };
  host.store.put(`note:${id}`, note);
  return note;
};
const list = async () => (await host.store.list('note:')).map((row) => row.value);
```

**Removal** is an operator-only action, not something a plugin or its page can trigger:
`weave plugin purge-data <pluginId>` (`DELETE /api/w/:ws/plugin-data/:pluginId`) deletes every row
for that plugin id. It deliberately sits outside `/api/w/:ws/plugins/:pluginId/` — a plugin's own
route prefix, and exactly what its page's bridge is scoped to reach — so a compromised or buggy page
can never wipe its own plugin's data.

### HTTP routes

```ts
registerHttpRoute(method: PluginHttpMethod, path: string, handler: PluginRouteHandler): void;
```

```ts
export type PluginHttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
export interface PluginRequestCtx {
  method: PluginHttpMethod; path: string; params: Record<string, string>; query: URLSearchParams;
  headers: Headers; json(): Promise<unknown>; text(): Promise<string>; workspaceId: string;
}
export type PluginRouteHandler = (req: PluginRequestCtx) => Promise<Response> | Response;
```

`path` is relative to the plugin's own mount point: `registerHttpRoute('GET', '/notes', ...)` on
plugin `notes` is reachable at `/api/w/:ws/plugins/notes/notes`. It is mounted inside the existing
workspace route group, so it inherits the same session-cookie auth as every other `/api/w/:ws/*`
route with no extra wiring — and, since that path is not in the run-token allowlist, an agent's run
token never authenticates there at all; only a human session does. A handler returns a standard
Fetch `Response`:

```js
host.registerHttpRoute('GET', '/notes', async () => Response.json({ notes: await list() }));
host.registerHttpRoute('POST', '/notes', async (req) => {
  const body = await req.json();
  if (!body || typeof body !== 'object' || typeof body.text !== 'string' || !body.text.trim()) {
    return Response.json({ error: 'text is required' }, { status: 400 });
  }
  return Response.json(create(body.text.trim()));
});
```

### A page

A plugin's page is nothing more than one more route — by convention `GET /page` — that returns
self-contained HTML. The web app renders it at `/w/:ws/plugins/:pluginId` inside an iframe sandboxed
**without `allow-same-origin`**: the page's origin is opaque, so it can never read the viewer's
session cookie, and its content-security-policy keeps `connect-src 'none'` — the page cannot make a
network call of its own, by construction, not by convention.

That is deliberate, not an oversight: a plugin's page can render agent- or user-authored data
(service names, note bodies), so a script-injection bug in it must not be able to ride the viewer's
own session and call arbitrary `/api/w/*` routes. The plugin's *server*-side code stays fully
trusted (see Trust model); only the *page* is boxed in this way.

**The postMessage bridge** is how the page still talks to the daemon. The host page (the app,
outside the iframe) listens for `message` events, accepts only ones whose `event.source` is that
exact iframe's `contentWindow`, and proxies a request or subscribes to events — scoped to that
plugin's own route prefix; a request path that would resolve outside
`/api/w/:ws/plugins/<pluginId>/` (a `..` escape, an absolute URL, another plugin's id, or a sibling
route like the purge-data one) is rejected without ever making an HTTP call.

**`weavePluginClient()`** is the page-side half, shipped as a string export,
`WEAVE_PLUGIN_CLIENT_JS`, from `@weave-ai/plugin-sdk` — inlined with a `<script>` tag, since a
plugin's page has no bundler:

```js
import { definePlugin, WEAVE_PLUGIN_CLIENT_JS } from '@weave-ai/plugin-sdk';

function pageHtml(host) {
  return `<!doctype html>
<html>
<head>
<style>${host.kitCss()}</style>
</head>
<body>
<script>${WEAVE_PLUGIN_CLIENT_JS}</script>
<script>
  var client = window.weavePluginClient();
  client.request('GET', '/notes').then(function (res) { /* res.data */ });
  client.onEvent('note.created', function (payload) { /* live update */ });
</script>
</body>
</html>`;
}
```

`client.request(method, path, body?)` posts `{ type: 'request', id, method, path, body }` to
`window.parent` and resolves with `{ status, data }` on the matching `{ type: 'response', id, ok:
true, ... }` reply, or rejects with `{ code, message }` on `ok: false`. `client.onEvent(kind,
handler)` posts `{ type: 'subscribe', kind }` once and calls `handler(payload)` for every forwarded
`{ type: 'event', kind, payload }` matching that `kind`.

**Styling.** `host.kitCss()` returns the Artifact Kit CSS — the same one `GET
/api/w/:ws/artifacts/kit.css` serves — so a plugin's page can match the app's visual tokens.
Inline it into a `<style>` block (as above); an opaque-origin frame's own `<link>` request cannot
reliably carry credentials cross-context, so linking the served asset directly does not work.
`kitCss()` is a method on the host, not a static import from `@weave-ai/core` — `@weave-ai/plugin-sdk`
(and everything built against it) may depend on `shared` and the runtime/channel/surface SDKs only,
never `core`.

**Nav.** A workspace's Settings and its sidebar both read the workspace summary
(`GET /api/w/:ws`)'s `plugins` field to know which loaded plugins registered a page; a "Plugins" nav
entry is rendered from that data, not compiled in per plugin.

### Events

```ts
emit(kind: string, entityId: string, payload: unknown): void;
```

Puts a `plugin.event` on the workspace's existing durable event outbox/SSE stream, tagged with the
emitting plugin's id — `pluginId`, `kind`, and `payload` all land in the event's own payload. A
plugin's page cannot open its own connection (its CSP forbids it); the host page's bridge forwards
only the events a page has subscribed to, off the one connection the app already holds — no second
SSE connection is opened per page.

```js
host.emit('note.created', id, note);
```

### Hooks, runtimes, channels, surfaces, forges, worktree providers

Unchanged by VS-334 — `registerHook`, `registerRuntime`, `registerChannel`, `registerSurface`,
`registerForge`, `registerWorktreeProvider` work as `docs/PLAN.md` §17 has always described. One
fix: a hook registered while loading workspace A now correctly fires only for A's own events (and
never for a workspace loaded before or after it) — earlier builds had this backwards, a pre-VS-334
landmine, not a documented feature ever relied on.

### Config and logging

```ts
config<T = Record<string, unknown>>(): T;
logger: Logger;
```

`config()` returns the `config:` block from that plugin's `plugins:` entry
(`{ name: '...', config: {...} }`); a bare string entry gets `{}`. `logger` is a structured logger,
already tagged with the plugin's id.

## Load order, failure containment, API versioning

Daemon-wide `plugins:` (from `daemon.yaml`) load before a workspace's own `plugins:` list, for every
workspace. Within one workspace's merged list, a duplicate `pluginId` is rejected (logged, the
second entry skipped) — the first one loaded wins. A plugin that throws while loading, or declares
an `apiVersion` this daemon doesn't support, is logged and skipped; every other plugin still loads,
and the daemon still starts.

`apiVersion: 1` is additive-only right now: every method this guide describes was added to version
1 without changing an existing one's signature, so `examples/plugins/echo-channel` — written before
any of this existed — still loads unchanged. A breaking change to an existing method would need a
new `apiVersion`.

## Management

A workspace's Settings → Plugins section (and its own summary, `GET /api/w/:ws`) lists every plugin
it loads: id, version, source (`workspace` or `daemon`), whether it loaded, and its error when it
didn't. Installing or removing a plugin is still editing `workspace.yaml` or `daemon.yaml` and
restarting the daemon — there is no installer.

## The full example

`examples/plugins/notes/` is the smallest thing that exercises all four new extension points at
once: an agent tool, storage, an HTTP route, and a page using the bridge — proof the extension
points are buildable, not a product (a Services plugin, tracking real deployments, is the intended
next thing built on top of this, in its own repository). Read it end to end alongside this guide;
every snippet above is quoted from it verbatim.
