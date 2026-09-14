## Context

Ground truth, verified on `main` @ `057ea4b2` (VS-376) unless noted:

- V1's plugin page is one static route, `/w/:ws/plugins/:pluginId` (`router.tsx:299`,
  `routes/PluginPage.tsx`), reading `useWorkspaceSummary().data.plugins` and iframing
  `/api/w/:ws/plugins/:pluginId/page` in a `sandbox="allow-scripts allow-forms"` frame with no
  `allow-same-origin`. The host-side bridge (`PluginPage.tsx:27-67`) is the whole security boundary:
  `resolveBridgePath` (`lib/pluginBridge.ts:30-48`) rejects anything that would resolve outside
  `/api/w/:ws/plugins/<pluginId>/`.
- V2 has no plugin route at all. Its routing is one shared `routeTree`
  (`router.tsx:118-379`): a pathless `v2ShellRoute` (rail/shell layout) parents both global pages
  (children of `v2ShellRoute` directly, e.g. `/needs`, `/live`) and `v2WsRoute` (`path: '/w/$ws'`,
  `router.tsx:180-184`), itself parenting every workspace-scoped page
  (`v2WsRoute.addChildren([...])`, `router.tsx:340-356`) — so **the V2 address for a workspace
  destination is `/v2/w/$ws/<section>`**. Every V2 page component is exported from one module,
  `packages/ui/src/v2/pages.tsx`, and wired via `lazyRouteComponent(() => import('./v2/pages'),
  '<ExportName>')` so the route tree never imports a page module eagerly.
- V2's rail is entirely data-driven off three arrays in `packages/ui/src/v2/nav.ts`:
  `V2_EVERYWHERE`, `V2_WORKSPACE`, `V2_KEPT` (each a list of `V2Dest { key, label, glyph,
  scopeKind, path, count? }`), rendered by `V2Shell.tsx`. `V2Shell.tsx`'s `WorkspaceGroups`
  (`V2Shell.tsx:192-275`) already renders one per-workspace, query-driven, non-static list after the
  static `V2_WORKSPACE` rows: that workspace's projects, fetched via `useWorkspaceProjects(ids)`
  (`api/hooks.ts:446-461`), a `useQueries` map keyed by workspace id with `staleTime: Infinity`. This
  is the exact precedent a per-workspace plugin list follows.
- `V2GlyphName` (`nav.ts:11-23`) is a closed union rendered by `V2Glyph` (`v2/Glyph.tsx`) via pure
  CSS-shape recipes in `V2_GLYPH_STYLE` (`nav.ts:152-205`) — no icon font, no SVG asset. A plugin row
  needs a new member.
- `activeNavKey(pathname)` (`nav.ts:77-133`) is the single source of truth for which rail row
  highlights; it pattern-matches `/v2/w/<ws>/<section>/<second>` and has no `plugins` case.
- `V2Page` (`v2/V2Page.tsx:80-114`, current main shape) has no `scroll` prop — its body is always
  `overflow-y-auto`. PR #309 (VS-371, ticket VS-371, still open, status `merging` with one failing
  check as of this writing) adds `scroll?: boolean` (default `true`) and a `data-v2-page-body`
  attribute switching the body between `overflow-y-auto` and a non-scrolling flex frame. **It has
  not landed on `main`** as of this design.
- `WorkspaceNav.tsx:128-145` (V1) is the working model for a data-driven plugin nav section:
  `pluginPages = activePlugins.filter(p => p.loaded && p.hasPage)`, rendered only for the *active*
  workspace (`WorkspaceNav.tsx:32-39`'s own comment: a non-active, collapsed workspace's summary is
  never fetched). V2 already fetches every listed workspace's projects regardless of active/collapsed
  state, so V2's plugin list does not need that restriction — see Decision 2.
- `pluginHost()` (`daemon.ts:453-487`) binds `kitCss: () => ARTIFACT_KIT_CSS` (`daemon.ts:480`).
  `ARTIFACT_KIT_CSS` (`packages/core/src/artifacts/kit.ts`) is a **hand-kept** copy of
  `packages/ui/src/index.css`'s tokens, drift-tested against it by `kit.test.ts` via
  `extractCssBlock`/`parseCssCustomProperties` (`packages/core/src/artifacts/parse.ts`). There is no
  build step generating any of `index.css`, `v2.css` or `ARTIFACT_KIT_CSS` from a shared source —
  all three are hand-authored CSS, kept honest only by that drift test.
- `packages/ui/src/v2/v2.css` is the V2 token source: `.v2-root { --bg-0: ...; ... }` (dark, the
  default) and `.v2-root[data-theme='light'] { ... }` (light), plus a handful of semantic classes
  (`.v2-tag`, `.v2-card`, `.v2-recessed`, `.v2-row`, `.v2-link`). It reuses V1's space/radius/font
  scale (`index.css`'s `:root` block) — it only overrides color/status/project/rail tokens. `Neither
  ARTIFACT_KIT_CSS nor v2.css defines `.page`/`.section`/`.table`/`.badge`/`.button`/`.input`/`.form-row`
  as reusable component classes today; those seven are new for this change.
- `@weave-ai/plugin-sdk`'s `package.json` has no `publishConfig`; the repo root is `"private":
  true`; nothing publishes it anywhere. `examples/plugins/notes` and `examples/plugins/echo-channel`
  both declare it as `"workspace:*"` and are themselves `pnpm-workspace.yaml` members — pnpm
  symlinks it into their own `node_modules`, so their bare `import { definePlugin } from
  '@weave-ai/plugin-sdk'` resolves today only because they are *inside* the workspace.
  `pluginSpecifier()` (`daemon.ts:444-451`) resolves only the plugin's own **entry** module (against
  the workspace root or an absolute/relative path); it has no bearing on that module's own imports.
  Once `import(pluginSpecifier(...))` starts executing a plugin file that lives entirely outside this
  repository (no `node_modules` of its own), Node's ESM resolver walks up from *that file's own
  directory*, never finds `@weave-ai/plugin-sdk`, and throws `ERR_MODULE_NOT_FOUND`. No existing
  mechanism in this codebase (no `NODE_PATH` use, no loader hook, no import map) addresses this —
  confirmed by search across `packages/server/src` and `packages/core/src`.
- `packages/server` and `packages/core` both already depend on `@weave-ai/plugin-sdk` as
  `workspace:*` (their own `package.json`s), so it is resolvable via ordinary Node resolution from
  any module that is part of `packages/server`'s own build — this is what the loader hook (Decision
  4) uses instead of a filesystem side effect.
- `PLUGIN_PAGE_CSP` (`packages/server/src/plugin-page-csp.ts`) already includes `style-src
  'unsafe-inline'`; inlining a second `<style>` block (a "V2 theme CSS") needs no CSP change.
- VS-384 (ticket VS-384, status `proposed`, not yet applied) plans to add a `rail: boolean` flag to
  `V2Dest` and derive `V2_RAIL_EVERYWHERE`/`V2_RAIL_WORKSPACE` from the existing arrays, changing how
  `V2Shell.tsx` reads `V2_WORKSPACE`. It does not touch the *appended*, query-driven rows after those
  arrays (projects today; plugins after this change) — this change's plugin rows are written to stay
  in that appended position specifically so the two do not collide regardless of merge order.

## Goals / Non-Goals

**Goals:** a V2 route and rail entry for a workspace's loaded plugin pages; a way for a plugin page
to use real V2 tokens and follow the app's live theme, with no plugin-authored CSS; a plugin outside
this monorepo resolving `@weave-ai/plugin-sdk` at runtime without vendoring it; `@weave-ai/plugin-sdk`
published to public npm as a self-contained package, so a plugin repository's own toolchain gets
real types with an ordinary install.

**Non-Goals:** actually running `npm publish` or pushing a release tag from within this ticket (the
workflow is written and left for a human to trigger); publishing any of `@weave-ai/shared`/
`runtime-sdk`/`channel-sdk`/`surface-sdk` (their types are bundled into `plugin-sdk`'s own
declaration file instead — Decision 5); redesigning the plugin contract's tools/storage/routes/
events (VS-334's territory, untouched here); making V1's plugin page theme-aware (its `kitCss()`
page never had a theme signal and this change does not add one to that path — see Decision 3's
note); resolving VS-384's rail refactor for it (only avoiding collision with it).

## Decisions

### Decision 1 — the V2 route mirrors V1's exactly: one static route, `$pluginId` dynamic

Add `v2WsRouteFor('plugins/$pluginId', 'V2PluginPage')` to `v2WsRoute.addChildren([...])`
(`router.tsx:340-356`), backed by a new `packages/ui/src/v2/PluginPage.tsx` exporting
`V2PluginPage`, re-exported from `pages.tsx` the way `V2WorkerPage` is (`pages.tsx:75`). It reads
`useWs()` for the workspace id and `useParams({ strict: false })` for `pluginId`, exactly as
`V2WorkerPage` does (`WorkerPage.tsx:41-48`). It reuses `resolveBridgePath`/`isPluginBridgeMessage`
from `../lib/pluginBridge` verbatim — the security boundary is identical regardless of which shell
hosts the iframe, so there is no reason to fork it.

**Alternatives considered:** forking the whole bridge into a `v2/` copy — rejected, doubles the
surface a security bug could hide in for zero benefit, since the bridge's contract does not change
between V1 and V2.

**Revised (plan review, 2026-09-14):** the page's title (and, per Decision 2, its rail label) use
the plugin's own declared display name when it has one, falling back to its id. Today's plugin
contract has no such field anywhere: `WeaveAIPlugin` (`packages/plugin-sdk/src/index.ts:117`) is
`{ id, version, apiVersion, register }`; `PluginRuntime` (`packages/core/src/plugins/index.ts:24-31`)
and `WorkspacePlugin` (`packages/ui/src/api/types.ts:191-198`) mirror it, `id`/`version` only. Add an
optional `name?: string` to all three, plumbed through unchanged: `WeaveAIPlugin.name` → each of
`loadPlugins`'s three `ctx.plugins.loaded.push({...})` call sites (`daemon.ts:423`, `:429`, `:433`) →
the workspace summary response (`routes/workspace.ts:23` already passes `ws.ctx.plugins.loaded`
straight through, so no route change beyond the type). `V2PluginPage`'s title and the rail row's
label both read `plugin?.name ?? plugin?.id ?? pluginId` (the last, route-param fallback, only for
the not-found state where no `WorkspacePlugin` entry exists at all).

### Decision 2 — the rail entry is a fourth query-driven row group, not a `V2_WORKSPACE`/`V2_KEPT` entry

Add `useWorkspacePlugins(ids)` to `packages/ui/src/api/hooks.ts`, mirroring
`useWorkspaceProjects(ids)` (`hooks.ts:446-461`) verbatim in shape: a `useQueries` map over
`qk.workspace(id)` (the same query the summary hook already uses — the plugin list is part of that
same response, so it shares the cache with `useWorkspaceSummary()` for the active workspace rather
than adding a second endpoint), returning `Record<string, WorkspacePlugin[]>` filtered to `{loaded:
true, hasPage: true}`. `V2Shell.tsx`'s `WorkspaceGroups` renders one row per entry, after the
projects block, using the same `RailRow`-shaped `<A>` (`v2-row` class, `V2Glyph name="plugin"`,
label = plugin id — matching V1's unlabelled `<span>{p.id}</span>`, `WorkspaceNav.tsx:136`), href
`/v2/w/$ws/plugins/$pluginId`. The collapsed rail and phone More list get the analogous addition
alongside their own existing per-workspace loops.

Unlike V1's restriction to the *active* workspace only (`WorkspaceNav.tsx:32-39`'s own reasoning —
a collapsed workspace's summary was never otherwise fetched), V2 already fetches every listed
workspace's projects regardless of expand state (`useWorkspaceProjects(ids)` takes every workspace
id, not just the active one), so extending `useWorkspacePlugins` to the same `ids` list costs
nothing new and keeps every workspace's rail internally consistent — a collapsed workspace group
should list its own plugins the moment it is expanded, not require a full data reload.

**Not** added to `V2_WORKSPACE`/`V2_KEPT`/`rail: boolean`-flagged static arrays: those are exactly
what VS-384 (unmerged) is mid-refactor on. A plugin row generated at render time, after the static
list, from workspace-summary data — the same relationship projects already have to `V2_WORKSPACE`
today — cannot conflict with a refactor of the *static* arrays' own derivation.

`activeNavKey` (`nav.ts:77-133`) gets one more `case`: `case 'plugins': return
\`plugin:${second}\`;`, following `case 'p': return \`project:${second}\`;`'s existing shape
(`nav.ts:106-107`).

`V2GlyphName` gains `'plugin'`; `V2_GLYPH_STYLE` gets a CSS-shape recipe for it in the same style as
the others (a 13×13 square outline with one clipped corner — visually distinct from every existing
glyph without needing an icon asset).

**Alternatives considered:** folding plugin rows into the existing More list (`V2_KEPT`'s current
home) instead of a dedicated section — rejected: VS-334's V1 precedent gives plugins their own
section, not the overflow list, and nothing about a plugin page is a "kept-but-demoted" V1 screen.

### Decision 3 — the styling contract is a semantic vocabulary; the daemon generates and pushes the actual CSS live

**Revised twice more (plan review, 2026-09-14, then captain directly via the weaver, same day):**
captain's own bar is explicit: *"build the plugin SDK to make it independent of the styling of
Weave. So if Weave styling changes, there shouldn't be drift for all plugins. All plugins should be
able to automatically inherit the styling from the new Weave style."* This replaces both the earlier
hand-kept-literal-with-drift-test design and the earlier invented seven-class-name layer. The
architecture now has three separate parts that must not be conflated:

**(a) The vocabulary — versioned, in the published npm package, contains no colour/spacing/font
values.** `@weave-ai/plugin-sdk` exports a small constant, e.g. `WEAVE_PLUGIN_CLASS = { section:
'v2-card', table: 'v2-table', badge: 'v2-tag', button: 'v2-button', input: 'v2-input', formRow:
'v2-form-row' } as const` plus the `data-theme` and `data-tone` attribute names it documents. A
plugin's page markup is `<div class={cls.section}>`, `<span class={cls.badge} data-tone="blocked">`,
etc. — literal class **names**, never their CSS. Changing this object is the only thing that bumps
`@weave-ai/plugin-sdk`'s own semver; the CSS behind the names can change every release with no SDK
version bump at all. Four of the six names are **not new selectors**: `section`→`v2-card`,
`badge`→`v2-tag` are the exact classes real V2 screens already use for those roles today (below), so
"have V2 components use them" is already true for those two without touching a single existing
screen.

**(b) The stylesheet — generated from `packages/ui/src/v2/v2.css`, never hand-kept, never shipped in
the npm package.** A new pure function, `generateV2PluginCss(v2CssSource: string): string`
(`packages/core/src/artifacts/v2-theme.ts`), given `v2.css`'s literal text:
- extracts `.v2-root { ... }` (re-rooted to `:root, [data-theme='dark']`) and
  `.v2-root[data-theme='light'] { ... }` (re-rooted to `[data-theme='light']`) via the existing
  `extractCssBlock`/`parseCssCustomProperties` helpers (`packages/core/src/artifacts/parse.ts`) —
  the token layer, verbatim values, not retyped;
- extracts the plain `.v2-root { background; color; font-family; ... }` base rule (`v2.css:129-137`)
  and re-roots it to `:root`/`body` — this **is** "page": base document chrome, not a distinct class;
- extracts `.v2-card`, `.v2-tag`, `.v2-button`, `.v2-input`, `.v2-form-row`, `.v2-table` **verbatim**
  (new classes added to `v2.css` itself for the four that don't already exist — see (c)) and
  concatenates them unchanged;
- appends one mechanically-generated rule per status token already in `V2_THEME_TOKEN_NAMES`
  (`--status-idle` … `--status-paused`, the same nine this file already enumerates): `[data-tone=
  'idle'] { color: var(--status-idle); }` and so on — `.v2-tag` relies on `currentColor` for its
  border and expects a colour utility class V2 gets from Tailwind; a plugin's static page has no
  Tailwind, so this is the one place a small amount of *generated* (not hand-typed) glue is needed.

The daemon reads `v2.css`'s real file at its own startup — `packages/ui/src/v2/v2.css`, resolved
repo-relative from the running release exactly the way `daemon.ts:583-589`'s `dirs()` already
resolves `AC_SKILLS_DIR`/`AC_TEMPLATES_DIR` (`resolve(here, '..', '..', '..')` to the repo root; a
release is a full clone-and-build, per `packages/release`, so the source file is present at runtime,
not only in a dev checkout) — and calls `generateV2PluginCss` once, caching the result for the
process's lifetime. **This is what makes point 2 literal, not aspirational**: restyle `v2.css`, ship
a release, and the next daemon start regenerates from the new file with no plugin-sdk version bump,
no plugin republish, and no plugin code change — captain's "ship a release" framing, not a build-time
snapshot baked into a package that would go stale the moment it's installed. `generateV2PluginCss`
itself stays a pure, fully unit-tested function (fed a string, asserted against expected output) so
this doesn't require a live daemon to verify.

**(c) Where the four new classes come from — real, in-use V2 recipes, not invented ones.** V2 has no
shared `Button`/`Input`/table component; every screen hoists ad hoc Tailwind one-offs. Concrete
values below are lifted from actual call sites, added to `v2.css` as the classes named in (a), and —
for `button` and `form-row` — retrofitted into the one real screen quoted, so the claim "V2 uses this
class" is true on `main`, not just true of the plugin stylesheet:
- **`.v2-button`** — `DecisionCard.tsx:532-538`'s secondary-action recipe (`h-9 rounded-r4 border
  border-line-2 px-3 text-meta text-text-1`) as the base, `DecisionCard.tsx:525-531`'s primary
  recipe (`bg-accent`, no border, `text-white`/`--accent-on`, `font-medium`) as `[data-variant=
  'primary']`, `:disabled` → `cursor: not-allowed; opacity: .55` (both recipes agree on this).
  **Retrofitted**: `DecisionCard.tsx`'s Approve/Cancel/Revise buttons now render `className="v2-button"
  data-variant={primary ? 'primary' : undefined}` instead of the two duplicated literal strings —
  same visual result, one real caller proven, existing `DecisionCard` tests re-run unchanged (className
  changes only).
- **`.v2-input`** — `Workspace.tsx:38`'s settings-density recipe (`h-8 rounded-r4 border border-line-2
  bg-bg-input px-2 text-micro text-text-1`, `:focus { border-color: var(--accent) }` per
  `V2Login.tsx:63`'s equivalent), chosen over `V2Login.tsx`/`V2Onboarding.tsx`'s pre-auth-only, larger
  variant as the more representative in-app density. **Retrofitted**: `Workspace.tsx`'s `GeneralSection`
  inputs use `.v2-input` in place of the local `inputCx` constant.
- **`.v2-form-row`** — `Workspace.tsx:53-64`'s stacked label-over-control recipe (`flex flex-col
  gap-1.5 px-3.5 py-3`, divided by `border-top: 1px solid var(--line-1)` between siblings — the same
  effect as the real `.v2-card divide-y divide-line-1` wrapper it lives in today), with the label
  child styled structurally (`.v2-form-row > span:first-child`) to `.ac-label`'s exact values (mono,
  10px, 500, uppercase, `--text-3`) so a plugin needs no separate label class. **Retrofitted**: the
  same `GeneralSection` rows.
- **`.v2-table`** — **not lifted from one real component**, because none exists (confirmed: no
  `<table>`, no `role="table"`, anywhere under `packages/ui/src/v2/`). Generalized from the recipe
  every real record list actually shares — `HistorySection.tsx:80-101`, `PullRequestsSection.tsx:103-
  133`, `Workspace.tsx`'s plugin-list rows, `Chart.tsx`'s `RankedBars` — a `.v2-card`-bodied container
  with `divide-y divide-line-1` rows, each row `flex items-center gap-3 px-3.5 py-2.5`, a `[data-cell=
  'primary']` cell (`min-width: 0; flex: 1 1 auto` + ellipsis) and `[data-cell='secondary']` cells
  (`flex: 0 0 auto`, `--ff-mono`, `--text-3`), `[data-row]:hover { background: var(--bg-2) }`. **Not**
  retrofitted into any real screen — `HistorySection`/`PullRequestsSection` draw a lane graph and
  multiple ad hoc columns that don't map onto this generalized shape without a much larger, separate
  refactor of screens this ticket has no reason to touch. Documented here as a bounded, honest gap
  rather than silently claimed as "the same as X."

**(d) The stylesheet reaches the plugin's page by the host pushing it, never the page fetching it.**
The plugin page's iframe has `connect-src 'none'` (VS-334) — it cannot `fetch()` anything itself,
including a CSS route, regardless of auth. So: add `GET /api/w/:ws/plugins/theme.css` (`packages/
server/src/routes/plugins.ts`, session-authenticated the same as every other workspace route,
mirroring the existing `GET /api/w/:ws/artifacts/kit.css` precedent) returning `generateV2PluginCss`'s
cached output as `text/css`. The **host page** (`V2PluginPage.tsx`, unsandboxed, ordinary CSP) fetches
it once and, together with the theme value (Decision 6), posts it into the iframe over the postMessage
bridge as soon as the iframe is available: `{ type: 'stylesheet', css }`. `weavePluginClient()`
(`WEAVE_PLUGIN_CLIENT_JS`) — already unconditionally inlined into every plugin page for `request`/
`onEvent` — is extended to, on construction and with no plugin code required: create a `<style
id="weave-plugin-styles">` element if absent, set its `textContent` on a `stylesheet` message, and set
`document.documentElement.dataset.theme` on a `theme` message. **A plugin using the vocabulary and the
existing client bootstrap script writes zero CSS and calls no styling API** — markup plus the two
messages already flowing through the bridge is the whole contract. `host.themeCss()` (kept, now
returning the SAME `generateV2PluginCss` output the route serves — not a second, different string)
stays available purely as an *optional* inline for a plugin's own server-rendered first paint (avoiding a flash before
the bridge round-trip completes); if a plugin uses it, the client's bridge-pushed copy still arrives
and re-applies on top, so first-paint use is never required for correctness, only for polish.

**Drift guard, extended per the review:** `v2-theme.test.ts` no longer just token-diffs a literal —
it (1) calls `generateV2PluginCss` with `v2.css`'s real current file content and asserts every
`WEAVE_PLUGIN_CLASS` value and `data-theme`/`data-tone` target has at least one matching rule in the
output (the completeness check), and (2) asserts the token values in the output match
`parseCssCustomProperties` run directly against `v2.css`'s own blocks (the no-divergence check) — so
a future edit to `v2.css` that removes `.v2-table` or changes a token without updating the generator
(there is nothing to update; the generator re-reads `v2.css` every time) is structurally impossible to
miss, rather than caught by a hand-kept copy falling out of sync.

`pluginHost()` (`daemon.ts:453-487`) gets `themeCss: () => generateV2PluginCss(...)` (cached) beside
the existing, untouched `kitCss: () => ARTIFACT_KIT_CSS`. Per the dependency-boundary rule VS-334's
own design.md already established (`docs/PLUGINS.md` already documents it): `@weave-ai/plugin-sdk`
may depend on `shared`/the three adapter SDKs only, never `core` — `themeCss()` is a host-filled
method, never a constant `plugin-sdk` imports; the published package carries only `WEAVE_PLUGIN_CLASS`
(names) and `WEAVE_PLUGIN_CLIENT_JS` (client logic), never a CSS value, matching captain's point 4
exactly.

**V1's plugin page is not touched.** It has never had any theme signal, and the ticket asks only to
keep V1 "working." Nothing here is wired into V1's route.

**Alternatives considered:** a hand-kept `V2_THEME_CSS` literal with a value-by-value drift test (the
rev-1 design) — rejected outright once captain's requirement made *generation* itself, not just
*verification*, the point: a hand-kept literal is frozen at whatever the ticket's author happened to
copy, and would go stale the instant `v2.css` next changes without a matching PR here, exactly the
drift captain is ruling out. A single `kitCss({ variant })` — rejected as in rev 1, unrelated to this
revision. Publishing the CSS inside `@weave-ai/plugin-sdk` itself — rejected per captain's point 4: it
would tie visual updates to an SDK release and every installed plugin's own upgrade cadence, the
opposite of "no plugin rebuild or republish."

### Decision 4 — the SDK resolves via a `module.registerHooks()` resolve hook, not a filesystem or npm change

**Revised at apply time** from the originally-planned `module.register()` + a hook loaded from a
separate compiled file: that shape hit a real dist-vs-source path mismatch (the hook file, loaded by
URL relative to `import.meta.url`, doesn't exist at that path when tests run against `src/` rather
than `dist/`). `module.registerHooks()` (Node ≥22.15/23.5, well within this repo's `>=22` floor and
the `26` `mise.toml` pin) is the newer, synchronous alternative: the hook function runs in the same
realm as the code that registers it, so it needs no separate file and no URL resolution at all.

`packages/server/src/register-plugin-sdk-hook.ts` exports `resolvePluginSdk` (typed against
`node:module`'s own `ResolveHookSync`): for the exact specifier `@weave-ai/plugin-sdk`, it returns
`{ url: pathToFileURL(createRequire(import.meta.url).resolve('@weave-ai/plugin-sdk')).href,
shortCircuit: true }`; every other specifier falls through to `nextResolve`. Because this module
ships inside `packages/server`'s own build, and `packages/server`'s own `package.json` already
depends on `@weave-ai/plugin-sdk` (`workspace:*`, confirmed in `daemon.ts`'s existing imports and
`package.json:29`), `createRequire(import.meta.url).resolve(...)` finds the daemon's own installed
copy regardless of where the *importing* plugin file lives on disk. `registerPluginSdkResolveHook()`
(same file) calls `registerHooks({ resolve: resolvePluginSdk })` once, guarded by a module-level
flag; `packages/server/src/bin.ts` calls it before `startDaemon()` runs, so it is active before any
workspace's plugins can load.

This resolves the actual gap identified: a plugin file with no `node_modules` of its own, anywhere
on disk, importing the bare specifier `@weave-ai/plugin-sdk`, now resolves to the exact SDK build the
running daemon ships — "the plugin never bundles or vendors it" holds for real, not just for
in-tree examples. Verified directly (not just unit-tested): an integration test writes a plugin file
to a fresh temp directory with no `node_modules`, points a scratch daemon's workspace config at it,
and confirms it loads (`packages/server/test/daemon.test.ts`).

**Alternatives considered and rejected:**
1. **Publish to npm/a private registry** — explicitly out of scope per the ticket ("Don't publish
   anything to any registry"); also the correct long-term complement (a plugin's own toolchain could
   then install a real dependency), noted as an Open Question below, not built here.
2. **Symlink `node_modules/@weave-ai/plugin-sdk` into the plugin's own directory at load time** —
   mutates a directory the daemon does not otherwise own (the plugin author's own repository), and
   composes badly if the daemon process has no write access there or the directory is read-only
   (e.g. mounted from a release artifact). The loader hook needs no write access anywhere.
3. **`NODE_PATH`** — only affects the legacy CJS `require()` global-path fallback, never the ESM
   resolver `import` uses, and every plugin here (`definePlugin`, `"type": "module"`) is ESM-only.
4. **`module.register()` + a separate hook file loaded by URL** — the originally-planned approach;
   dropped once it hit the dist-vs-source mismatch above. `registerHooks()` is also not deprecated
   (`register()` is, as of this writing), and needs no `shortCircuit`-aware second `load` hook to stay
   simple, since only `resolve` is needed here.

### Decision 5 — `@weave-ai/plugin-sdk` is published to public npm; the loader hook is the runtime story, publishing is the types story

**Superseded 2026-09-14 00:49 by captain, relayed by the weaver:** the original Decision 5 (a CLI
command reading a daemon-served `.d.ts` bundle, "don't publish anything to any registry") is
replaced. Captain chose to publish `@weave-ai/plugin-sdk` to public npm instead. Decision 4's loader
hook is unaffected and stays exactly as designed — it is still how the *running daemon* resolves a
plugin's bare import at load time, regardless of what that plugin's own `package.json` declares.
Publishing only changes how a plugin repository's own toolchain (its `tsc`, its editor, its own
`npm install`) gets the package.

**Make the package standalone-publishable** (`packages/plugin-sdk/package.json`): keep `"license":
"AGPL-3.0-only"` (already correct), add `"repository"` (pointing at this repo, matching the license's
own copyleft — a plugin author sees where the source is), add `"files": ["dist"]` so nothing else
in the package directory ships, keep `"exports"`/`"types"` as they are (already correct), and add
`"publishConfig": { "access": "public" }` (the package name is scoped, `@weave-ai/...`, so without
this an ordinary `npm publish` would default to requiring a paid org or fail outright).

**The `.d.ts` must have no unresolved imports.** Today's `dist/index.d.ts` (once built) still
`import`s types from `@weave-ai/runtime-sdk`, `@weave-ai/channel-sdk`, `@weave-ai/surface-sdk` and
`@weave-ai/shared` — none of which are published. Two ways to close that: publish those four
packages too, as real npm dependencies; or bundle the types they contribute directly into
`plugin-sdk`'s own emitted declaration file, so the published package is fully self-contained.
**Chosen: bundle.** `RuntimeAdapter`/`ChannelAdapter`/`SurfaceAdapter`/`WorkspaceEvent`/`EventType`
are the only things pulled in from those four packages, all `import type` only — no runtime code
crosses the boundary — and most plugins will only ever touch `AgentToolDefinition`, `PluginStore`,
`PluginRequestCtx`, `PluginHost` and `definePlugin` (all already declared directly in `plugin-sdk`'s
own source), not the adapter-registration types. Publishing four more packages turns each into a
public API this project has to keep semver-stable indefinitely for a surface almost no plugin
exercises; bundling keeps the public commitment to exactly the one package the ticket is actually
about. Add a `build:publish` step to `packages/plugin-sdk`'s `package.json` (a dedicated
`dts-bundle-generator` — or equivalent rollup-plugin-dts — pass over `dist/index.d.ts`, run only for
the publish workflow, never for `pnpm build`/`pnpm typecheck`, which keep using project references
exactly as today) producing a self-contained `dist/index.d.ts` with every referenced type inlined.

**Prove it before wiring the automation.** `npm pack` the package into a temp directory, `npm
install` the resulting tarball into a fresh throwaway project scaffolded outside the monorepo (a
`/tmp` directory, its own minimal `package.json`/`tsconfig.json`), write a one-line
`definePlugin`-based sample importing from `@weave-ai/plugin-sdk`, and run `tsc --noEmit` against it
— asserting zero errors and, separately, that the sample's import does **not** resolve to anything
inside this repository (proving the published tarball is genuinely self-contained). This is a
build/tooling check, not a network operation — `npm pack`/`npm install` of a local tarball touch no
registry and need no token, so it is safe to run and verify directly in this ticket.

**A GitHub Actions workflow publishes on a tag, never run from here.** Add
`.github/workflows/publish-plugin-sdk.yml`: triggers on `push: tags: ['plugin-sdk-v*']`, builds
(`pnpm install --frozen-lockfile`, `pnpm --filter @weave-ai/plugin-sdk build` then the
`build:publish` bundling step), and runs `npm publish --access public` (`--provenance` when the
runner supports it, which needs `permissions: { id-token: write }` and `contents: read` on the job)
authenticated with an `NPM_TOKEN` repository secret via `.npmrc`/`NODE_AUTH_TOKEN`, the standard
`actions/setup-node` + registry-url pattern this kind of workflow uses. Captain adds the `NPM_TOKEN`
secret; this ticket never asks for it, never handles it, never runs `npm publish`, and never pushes a
`plugin-sdk-v*` tag — the workflow is written and left for a human to trigger by tagging a release.

**The runtime side is unchanged from Decision 4:** the daemon's `module.register()` hook still
redirects a bare `@weave-ai/plugin-sdk` import to its own running copy regardless of what is
installed anywhere else, so a loaded plugin never actually needs the npm-installed copy at runtime —
publishing is purely for the plugin author's own toolchain. `docs/PLUGINS.md` documents the
plugin-side declaration as both a `peerDependency` (satisfied at runtime by the hook; a real version
range so a type checker knows what it's checking against) and a `devDependency` (satisfied by the
real npm install, for local typecheck/editor support) on `@weave-ai/plugin-sdk`.

**`weave plugin types <targetDir>` is dropped, not kept as a fallback.** It existed only to work
around not being able to publish; now that a real `npm install @weave-ai/plugin-sdk` gives a plugin
author working types with zero daemon involvement, a second, parallel, daemon-route-backed delivery
path for the same file would be one more thing to keep in sync with the published package's own
version for a scenario (no npm registry access) nobody has asked for. Dropped: the
`GET /api/plugin-sdk/types` route and the CLI subcommand from the original Decision 5 are removed
from this change's task list entirely.

**Alternatives considered:** publishing all four upstream packages as real dependencies — rejected
above (unbounded public-API surface for near-zero actual use); a GitHub release asset instead of npm
— rejected, since `peerDependencies`/`devDependencies` and ordinary `npm install` are what every
plugin author's toolchain already expects, and npm is what captain chose.

### Decision 6 — `theme` and `stylesheet` are new host→page bridge messages; the client applies both automatically

**Revised (plan review, 2026-09-14):** applying the pushed values is no longer left to the plugin
author. Add two host→page-only message shapes to `packages/ui/src/lib/pluginBridge.ts`, alongside
the existing `request`/`subscribe` (page→host) shapes — neither is validated by
`isPluginBridgeMessage`, which only guards page→host traffic, same as the existing `response`/`event`
shapes:
```ts
export interface PluginBridgeThemeMessage { type: 'theme'; theme: 'dark' | 'light' }
export interface PluginBridgeStylesheetMessage { type: 'stylesheet'; css: string }
```
`V2PluginPage.tsx` fetches `GET /api/w/:ws/plugins/theme.css` (Decision 3(d)) once per mount and,
as soon as the iframe reports `available`, posts `{ type: 'stylesheet', css }` followed by
`{ type: 'theme', theme }` (reading whatever hook/context already drives `.v2-root[data-theme]` for
the rest of the app — `V2Root.tsx`'s existing theme state); the `theme` message alone repeats on every
later theme change (the stylesheet itself only changes across a daemon restart on a new release, so
it is fetched and pushed once, not re-fetched on a timer).

`WEAVE_PLUGIN_CLIENT_JS` (`packages/plugin-sdk/src/index.ts:128-161`) is extended so that calling
`window.weavePluginClient()` — already required, unconditionally, for `request`/`onEvent` — has the
side effect of listening for both messages and applying them with no plugin code: on `stylesheet`, it
creates (once) a `<style id="weave-plugin-styles">` element and sets its `textContent`; on `theme`, it
sets `document.documentElement.dataset.theme`. Both are automatic, not opt-in — a plugin using only
the vocabulary and this one bootstrap script needs no `onTheme` callback and writes no CSS at all,
per captain's bar. `onTheme(handler)` is kept as an *additional*, optional subscription for a plugin
that wants to react further (e.g. redraw a canvas on theme change); it no longer does the base
application work, since that now happens unconditionally inside the client itself.

**V1 is unaffected**, as before: neither message is ever posted from V1's route.

## Risks / Trade-offs

- **[The daemon reads `packages/ui/src/v2/v2.css` off its own release checkout at startup]** →
  precedented, not novel: `daemon.ts:583-589`'s `dirs()` already resolves `AC_SKILLS_DIR`/
  `AC_TEMPLATES_DIR` the same repo-relative way, and a release is a full clone-and-build (per
  `packages/release`), not a pruned artifact, so the source file is present. Mitigated further by
  task 1.5's explicit fallback: a missing file logs a warning and serves a minimal safe stylesheet
  rather than crashing the daemon or failing every plugin page.
- **[`.v2-table` is a generalized recipe, not lifted from one real component]** → named as such in
  Decision 3(c) and task 1.1 rather than silently claimed as "the same as X"; the rendered-comparison
  task (9.2) is expected to show it as visually close but not pixel-identical to any one existing
  list, and that is an accepted, documented gap, not a bug to chase.
- **[VS-334's own OpenSpec archive has not reached `main`]** → `openspec/specs/plugins/` does not
  exist yet on `main` (verified: VS-334 merged its code as `6f51a600`, but its archive commit
  `33034d7d` lives only on the unmerged branch `origin/ac/archive-vs-334-plugins-can-add-agent-
  tools-their-own-st`). `openspec validate --strict` on this change reports this as an INFO, not an
  error (`plugins/web-pages: target spec does not exist; only ADDED requirements are allowed for new
  specs`), and the change is otherwise valid. This is a pre-existing sequencing gap in the workspace,
  not something this ticket caused or can fix — the archive branch landing is outside this ticket's
  project-boundary and worktree. If it is still unmerged when this change reaches archive, that step
  needs VS-334's archive branch merged first (or the daemon's archive tooling to treat the first-ever
  MODIFIED delta against a not-yet-archived capability as the effective base) — flagged here rather
  than discovered as a surprise at landing time.
- **[VS-371/#309 not yet on `main`]** → the V2 plugin page needs a non-scrolling body for its iframe
  to fill correctly, and that's exactly what #309's `V2Page.scroll` prop gives. Add the same prop
  locally, matching #309's exact name/shape/default, if it has not landed by the time this change
  reaches apply; rebase onto it instead if it has. Either way the diff at the call site is identical.
- **[VS-384 unmerged, also touches `nav.ts`/`V2Shell.tsx`]** → mitigated by Decision 2: this change's
  plugin rows are appended data, not a static-array edit, so they do not touch the same lines VS-384
  is refactoring. A rebase either direction should be a clean merge, not a conflict.
- **[`examples/plugins/notes` switching from `workspace:*` to `peerDependencies`]** → the example
  currently resolves inside the monorepo only because pnpm's own workspace linking puts it in
  `node_modules`; declaring it a peer dependency instead relies on the new loader hook to resolve it,
  in-tree or out. This is deliberate — it is the same resolution path a real out-of-tree plugin uses,
  so the example proves the mechanism rather than merely working by virtue of being in-tree. Existing
  loader tests must still pass once the hook is registered in the test harness the same way the
  daemon registers it at boot.
- **[A resolve hook is process-global]** → registered once, unconditionally, at daemon boot,
  regardless of whether any workspace ever loads a plugin. It only special-cases one exact specifier
  string and falls through to `nextResolve` for everything else, so it cannot affect the resolution
  of any other import in the process.

## Migration Plan

Additive throughout: `kitCss()` unchanged, V1's route unchanged, `apiVersion` stays `1`. A plugin
written against VS-334's contract keeps working with no changes. A plugin author who wants V2
styling/theming and out-of-tree distribution opts in to the new `themeCss()`/`onTheme()`/loader-hook
path; nothing forces the switch.

## Open Questions

- None outstanding for this decision as of 2026-09-14: captain settled publishing to public npm.
  Whether `@weave-ai/shared`/`runtime-sdk`/`channel-sdk`/`surface-sdk` are ever published in their
  own right (rather than having their needed types bundled into `plugin-sdk`) is not decided here and
  not needed for this change — Decision 5's bundling approach has no dependency on that answer either
  way.
