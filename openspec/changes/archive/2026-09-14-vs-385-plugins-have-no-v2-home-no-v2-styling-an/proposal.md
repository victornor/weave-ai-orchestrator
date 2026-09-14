## Why

VS-334 gave plugins a page, storage, tools, routes and a nav entry — but every part of that
contract still assumes V1. The Services plugin (VS-381) is meant to be Weave AI's first real
plugin and the template others build from, built directly for V2, with no styling of its own and
the real SDK. Today it cannot be: V1's `/w/:ws/plugins/:pluginId` route has no V2 counterpart or
rail entry; `host.kitCss()` only returns V1's Artifact Kit CSS, so a plugin page can never look
like V2's Mono theme or follow its live dark/light toggle; and `@weave-ai/plugin-sdk` is not
published anywhere and is workspace-linked only via `pnpm`'s `workspace:*` protocol, so a plugin
living in its own repository (outside this monorepo) cannot `import` it at all without vendoring a
copy that drifts from the daemon it runs against. This change closes those three gaps in Weave AI
itself, so VS-381 (and every plugin after it) needs no workaround.

## What Changes

- Add a V2 route for a workspace's plugin page (`/v2/w/:ws/plugins/:pluginId`), mirroring V1's
  static, dynamic-`$pluginId` route rather than a route per plugin; keep V1's route working
  unchanged.
- Add a data-driven V2 rail entry (expanded rail, collapsed rail, phone More list) for each of a
  workspace's own loaded plugins that registered a page — sourced from the workspace summary, the
  same way V1's `WorkspaceNav` already does it, so no plugin needs a build-time nav-array entry.
- Add `V2Page`'s `scroll` prop locally if PR #309 (VS-371) has not landed by apply time, matching
  its shape exactly so a later rebase is a no-op; use it (or #309's own prop, if it has landed) so
  the plugin page's iframe fills the body without an extra scrollbar.
- **Superseded twice more 2026-09-14 (plan review, then captain directly):** the styling contract is
  a small semantic vocabulary (`WEAVE_PLUGIN_CLASS` — `section`, `table`, `badge`, `button`, `input`,
  `formRow`, plus `data-theme`/`data-tone`), published in `@weave-ai/plugin-sdk` with no colour,
  spacing or font values in it at all. The actual CSS behind that vocabulary is generated at daemon
  startup by a pure function reading `packages/ui/src/v2/v2.css`'s real file content — never a
  hand-kept literal, never shipped inside the npm package — and served/pushed live: a new
  `GET /api/w/:ws/plugins/theme.css` route, fetched once by the V2 plugin page (the sandboxed iframe
  itself cannot fetch anything; `connect-src 'none'`) and posted into the iframe over the bridge
  alongside the theme value. `weavePluginClient()` applies both automatically — a `<style>` injection
  and a `data-theme` attribute — with no plugin code required. `.v2-card`/`.v2-tag` (real, already-used
  V2 classes) back `section`/`badge` unchanged; `.v2-button`/`.v2-input`/`.v2-form-row` are new V2
  classes lifted from real call sites and retrofitted into at least one real screen each; `.v2-table`
  is a generalized, not-yet-adopted recipe (named as such). `host.themeCss()` stays as an optional
  first-paint inline returning the identical generated string. See design.md Decisions 3 and 6.
- Add `theme` and `stylesheet` messages to the postMessage bridge protocol, host→page only: the V2
  plugin page route posts both once the iframe is available, and `theme` again on every later theme
  change. V1's route and bridge are unchanged; this is V2-only wiring, since V1's page has never had a
  way to know the app's theme or stylesheet.
- Add a Node ESM `module.register()` resolution hook, registered once at daemon startup, that
  redirects the bare specifier `@weave-ai/plugin-sdk` — for any importer, anywhere on disk — to the
  running release's own built `@weave-ai/plugin-sdk`. A plugin outside this monorepo, with no
  `node_modules` of its own, can `import { definePlugin } from '@weave-ai/plugin-sdk'` and reach the
  exact copy the daemon runs.
- **Superseded 2026-09-14 by captain, relayed by the weaver:** publish `@weave-ai/plugin-sdk` to
  public npm (`publishConfig.access: public`), with a self-contained `.d.ts` (the types it needs from
  `@weave-ai/runtime-sdk`/`channel-sdk`/`surface-sdk`/`shared` bundled in, not those packages
  published too), proven with `npm pack` into a fresh out-of-tree project that installs the tarball
  and typechecks a sample plugin against it. A GitHub Actions workflow (`.github/workflows/publish-
  plugin-sdk.yml`) publishes on a `plugin-sdk-v*` tag using an `NPM_TOKEN` secret captain adds — this
  ticket writes that workflow but never runs `npm publish` and never pushes a tag. A plugin declares
  `@weave-ai/plugin-sdk` as both a `peerDependency` (satisfied at runtime by the loader hook above)
  and a `devDependency` (satisfied by the real npm install, for local types). The originally-planned
  `weave plugin types <dir>` CLI command and its daemon route are dropped, not kept as a fallback —
  see design.md Decision 5.
- Update `docs/PLUGINS.md` and `examples/plugins/notes` to the V2 page, `themeCss()`/the theme
  bridge, the host-resolved SDK, and the published-package install path; record the still-1
  `apiVersion` and that existing plugins keep working unchanged.

**BREAKING (internal only):** none. `kitCss()` is untouched; `themeCss()`, the vocabulary, the
`theme`/`stylesheet` bridge messages and the resolution hook are additive. A plugin that ignores all
of them behaves exactly as it does today.

## Capabilities

### New Capabilities

- `plugins/sdk-resolution`: a plugin's own bare `@weave-ai/plugin-sdk` import resolves to the
  daemon's running release without vendoring at runtime, and the package is published to public npm,
  self-contained, so a plugin repository's own toolchain gets real types with an ordinary install.

### Modified Capabilities

- `plugins/web-pages`: the page and nav entry now exist in V2 as well as V1; a plugin page uses a
  small versioned class/attribute vocabulary that a daemon-generated, live-pushed stylesheet backs
  with V2's real styling, following the app's live theme, with no CSS or style values in the plugin
  or the SDK.

## Impact

- `packages/ui/src/router.tsx` — one new V2 route, child of `v2WsRoute`.
- `packages/ui/src/v2/PluginPage.tsx` (new), `packages/ui/src/v2/pages.tsx` — the V2 page component.
- `packages/ui/src/v2/nav.ts` — a `plugin` glyph, an `activeNavKey` case for the plugin route.
- `packages/ui/src/v2/V2Shell.tsx`, `packages/ui/src/api/hooks.ts` — a per-workspace plugin list
  (`useWorkspacePlugins`), rendered as rail rows in the expanded rail, collapsed rail and More list.
- `packages/ui/src/v2/V2Page.tsx` — `scroll` prop, only if not already present from #309 by apply
  time.
- `packages/ui/src/v2/Glyph.tsx` — a `plugin` glyph case.
- `packages/plugin-sdk/src/index.ts` (`WeaveAIPlugin.name?`), `packages/core/src/plugins/index.ts`
  (`PluginRuntime.name`), `packages/ui/src/api/types.ts` (`WorkspacePlugin.name`),
  `packages/server/src/daemon.ts` (`loadPlugins`'s three `ctx.plugins.loaded.push` sites) — an
  optional plugin display name, used as the page title and rail label with a fallback to the id.
- `packages/ui/src/v2/v2.css` — four new classes (`.v2-button`, `.v2-input`, `.v2-form-row`,
  `.v2-table`); `DecisionCard.tsx`, `Workspace.tsx` (settings) — retrofitted to use the new button/
  input/form-row classes in place of their local literal Tailwind strings.
- `packages/core/src/artifacts/v2-theme.ts` (new), `v2-theme.test.ts` (new) — `generateV2PluginCss`
  (a pure function, not a literal) and its completeness/no-divergence drift test.
- `packages/server/src/routes/plugins.ts` — `GET /api/w/:ws/plugins/theme.css`.
- `packages/server/src/daemon.ts` — `pluginHost()` gains `themeCss()` returning the same generated
  string the route serves; reads `packages/ui/src/v2/v2.css` once at startup, cached.
- `packages/server/src/plugin-sdk-resolve-hook.ts` (new), `packages/server/src/bin.ts` — the
  `module.register()` hook and its one-time registration.
- `packages/plugin-sdk/package.json` — `files`, `repository`, `publishConfig.access: public`, a
  `build:publish` bundling step; `packages/plugin-sdk/src/index.ts` — `WEAVE_PLUGIN_CLASS` vocabulary
  constant, `themeCss()` on `PluginHost`, the stylesheet-injection/theme-application logic in
  `WEAVE_PLUGIN_CLIENT_JS`, `onTheme()` kept as an optional extra subscription.
- `.github/workflows/publish-plugin-sdk.yml` (new) — publish-on-tag, never triggered from this
  ticket.
- `packages/ui/src/lib/pluginBridge.ts` — `theme`/`stylesheet` message shapes (host→page; not
  validated as incoming, same as the existing `response`/`event` shapes).
- `examples/plugins/notes/` — updated to the vocabulary/bridge pattern and `peerDependencies`/
  `devDependencies` on the published package name; writes no CSS.
- `docs/PLUGINS.md`, `docs/PLAN.md` §17 — the settled contract, including the publish/install path
  and the styling architecture principle.
