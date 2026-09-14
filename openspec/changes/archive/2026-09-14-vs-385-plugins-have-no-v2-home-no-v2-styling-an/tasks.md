## 1. V2's own CSS grows the four missing shared classes, and the plugin stylesheet is generated from it

- [x] 1.1 Add four classes to `packages/ui/src/v2/v2.css`, values lifted from real call sites (cited
      in design.md Decision 3(c), not invented): `.v2-button` (base = `DecisionCard.tsx:532-538`'s
      secondary recipe: 36px tall, `border: 1px solid var(--line-2)`, `border-radius: 4px`,
      transparent background, `var(--text-1)`, `font-size` = `--fs-meta`; `[data-variant='primary']`
      = `DecisionCard.tsx:525-531`'s recipe: no border, `background: var(--accent)`,
      `color: var(--accent-on)`, `font-weight: 500`; `:disabled { cursor: not-allowed; opacity: .55 }`
      on both); `.v2-input` (`Workspace.tsx:38`'s settings-density recipe: 32px tall, `border: 1px
      solid var(--line-2)`, `border-radius: 4px`, `background: var(--bg-input)`,
      `color: var(--text-1)`, `font-size` = `--fs-micro`, `:focus { border-color: var(--accent) }`
      per `V2Login.tsx:63`); `.v2-form-row` (`Workspace.tsx:53-64`'s stacked recipe: `flex-direction:
      column`, `gap: 6px`, `padding: 12px 14px`, `+ .v2-form-row { border-top: 1px solid
      var(--line-1) }`, and a structural `> span:first-child` / `> label > span:first-child` rule
      matching `.ac-label`'s exact values — mono, `--fs-nano`, 500, uppercase, `var(--text-3)` — so a
      plugin needs no separate label class); `.v2-table` (generalized, not lifted from one real
      component — documented in the same comment as such — a `.v2-card`-shaped `divide-y
      divide-line-1` container of `[data-row]` rows, `flex items-center gap-3` at the same padding as
      `Workspace.tsx`'s plugin-list rows, `[data-row]:hover { background: var(--bg-2) }`, `[data-cell=
      'primary']` = `min-width: 0; flex: 1 1 auto` + ellipsis, `[data-cell='secondary']` = `flex: 0 0
      auto; font-family: var(--ff-mono); color: var(--text-3)`).
- [x] 1.2 Retrofit real usages to prove the new classes are the app's own, not invented for plugins:
      `DecisionCard.tsx`'s Approve/Cancel/Revise buttons render `className="v2-button"
      data-variant={primary ? 'primary' : undefined}` instead of their two duplicated literal Tailwind
      strings; `Workspace.tsx`'s `GeneralSection` renders its rows as `.v2-form-row` and its inputs as
      `.v2-input` instead of the local `inputCx` constant. Verify existing `DecisionCard`/`Workspace`
      settings tests still pass unmodified (className changes only, same rendered behaviour).
- [x] 1.3 Add `packages/core/src/artifacts/v2-theme.ts`: a pure function `generateV2PluginCss(v2Css:
      string): string` — never a hand-typed literal. It: extracts `.v2-root {`/`.v2-root[data-
      theme='light'] {` via the existing `extractCssBlock`/`parseCssCustomProperties`
      (`packages/core/src/artifacts/parse.ts`) and re-roots them to `:root, [data-theme='dark']`/
      `[data-theme='light']`; extracts the plain `.v2-root { background; color; font-family; ... }`
      base rule and re-roots it to `:root, body` (this is "page" — base chrome, not a class); extracts
      `.v2-card`, `.v2-tag`, `.v2-button`, `.v2-input`, `.v2-form-row`, `.v2-table` verbatim; appends
      one generated `[data-tone='X'] { color: var(--status-X); }` rule per status token name already
      in this file's own token-name list (`--status-idle` … `--status-paused`), since `.v2-tag` relies
      on a Tailwind colour utility class the plugin page has none of. Also export `WEAVE_PLUGIN_CLASS
      = { section: 'v2-card', table: 'v2-table', badge: 'v2-tag', button: 'v2-button', input:
      'v2-input', formRow: 'v2-form-row' } as const` (the vocabulary-to-class-name map).
- [x] 1.4 Add `packages/core/src/artifacts/v2-theme.test.ts`: (a) completeness — call
      `generateV2PluginCss` with `v2.css`'s real current content and assert every `WEAVE_PLUGIN_CLASS`
      value and every `data-theme`/`data-tone` target has at least one matching rule in the output;
      (b) no-divergence — assert the output's token values equal `parseCssCustomProperties` run
      directly against `v2.css`'s own blocks. Verify (a) fails if a class is temporarily removed from
      the generator's extraction list, and (b) fails if a token value is temporarily edited in a copy
      of the input before reverting — this is what proves it is generation, not a copy that can go
      stale.
- [x] 1.5 Add `packages/server/src/daemon.ts` (or a small new module it calls) reading `packages/ui/
      src/v2/v2.css`'s real file content once at daemon startup — resolved repo-relative from the
      running release the same way `dirs()` (`daemon.ts:583-589`) already resolves `AC_SKILLS_DIR`/
      `AC_TEMPLATES_DIR` — calling `generateV2PluginCss`, and caching the result for the process's
      lifetime; log a warning and fall back to a minimal safe stylesheet (never crash the daemon) if
      the file is unexpectedly missing. Verify with a test that two different `v2.css` fixture
      contents (fed via a temp file or an injected path) produce two different generated outputs, and
      that a missing file degrades instead of throwing.

## 2. Host and bridge expose the vocabulary, the generated stylesheet, and the live theme

- [x] 2.1 Export `WEAVE_PLUGIN_CLASS` (task 1.3) from `packages/plugin-sdk/src/index.ts` — the
      published vocabulary, names only, no CSS. Add `themeCss(): string` to `PluginHost`, documented
      the same way `kitCss()` is — a method, not a static import, so `@weave-ai/plugin-sdk` never
      depends on `@weave-ai/core` or ships a style value. Bind it in `pluginHost()`
      (`packages/server/src/daemon.ts`) to the cached `generateV2PluginCss` output from task 1.5,
      beside the untouched `kitCss: () => ARTIFACT_KIT_CSS`. Verify with a unit test that
      `host.themeCss()` returns the same string the route in task 2.2 serves, and that `host.kitCss()`
      is unchanged.
- [x] 2.2 Add `GET /api/w/:ws/plugins/theme.css` (`packages/server/src/routes/plugins.ts`),
      session-authenticated like every other workspace route, returning the same cached generated
      string as `text/css`. Verify with a route test.
- [x] 2.3 Add `PluginBridgeThemeMessage { type: 'theme'; theme: 'dark' | 'light' }` and
      `PluginBridgeStylesheetMessage { type: 'stylesheet'; css: string }` to `packages/ui/src/lib/
      pluginBridge.ts`, documented as host→page only (not validated by `isPluginBridgeMessage`, which
      guards page→host traffic, same as the existing `response`/`event` shapes).
- [x] 2.4 Extend `WEAVE_PLUGIN_CLIENT_JS` (`packages/plugin-sdk/src/index.ts`) so that calling
      `window.weavePluginClient()` — already required for `request`/`onEvent` — also, unconditionally
      and with no plugin code: creates a `<style id="weave-plugin-styles">` element (once) and sets
      its `textContent` on a `stylesheet` message; sets `document.documentElement.dataset.theme` on a
      `theme` message. Keep `onTheme(handler)` as an additional, optional subscription for a plugin
      that wants to react further — it no longer does the base application work itself. Verify with a
      unit test using a fake `window.parent`/`postMessage`: a `stylesheet` message results in the
      style element's content being set; a `theme` message results in the dataset attribute being
      set; both happen with zero calls into any plugin-registered callback.
- [x] 2.5 Add an optional `name?: string` to `WeaveAIPlugin` (`packages/plugin-sdk/src/index.ts`),
      `PluginRuntime` (`packages/core/src/plugins/index.ts:24-31`) and `WorkspacePlugin`
      (`packages/ui/src/api/types.ts:191-198`); thread it through `loadPlugins`'s three
      `ctx.plugins.loaded.push({...})` call sites (`packages/server/src/daemon.ts:423,429,433`).
      `routes/workspace.ts:23` needs no change (`plugins: ws.ctx.plugins.loaded` already passes the
      whole shape through). Verify with a unit test that a plugin declaring `name` shows it on the
      workspace summary's `plugins` entry, and one that doesn't declare it has `name: null`/`undefined`
      there, not an error.

## 3. V2 plugin page route

- [x] 3.1 Add `packages/ui/src/v2/PluginPage.tsx` exporting `V2PluginPage`: reads `useWs()` and
      `useParams({ strict: false })` for `pluginId`, `useWorkspaceSummary()` for the plugin list,
      renders inside `V2Page` (title = the matched plugin's `name` if present, else its `id`, else the
      raw route param — task 2.5's field) with `scroll={false}` (see task 3.2), and an `<iframe>`
      pointed at `/api/w/${ws}/plugins/${pluginId}/page`, `sandbox="allow-scripts allow-forms"`,
      filling the body. Reuse `resolveBridgePath`/`isPluginBridgeMessage` from `../lib/pluginBridge`
      and the same request/subscribe/event bridge logic as V1's `routes/PluginPage.tsx`, adapted to
      read `stream`/`ws` from V2's own workspace context. Fetch `GET /api/w/:ws/plugins/theme.css`
      once (task 2.2) and, in a `useEffect`, post `{ type: 'stylesheet', css }` then `{ type: 'theme',
      theme }` once the iframe is available, and post `{ type: 'theme', theme }` again whenever the
      app's current V2 theme value changes (the stylesheet is not re-fetched or re-posted after the
      first push). Render the same not-found state as V1 when the plugin isn't loaded or has no page.
      Re-export `V2PluginPage` from `packages/ui/src/v2/pages.tsx`.
- [x] 3.2 Check whether PR #309 (VS-371, `V2Page.scroll`) has landed on `main`. If yes: rebase onto
      it and use its `scroll` prop as-is. If not: add `scroll?: boolean` (default `true`) and a
      `data-v2-page-body={scroll ? 'scroll' : 'fill'}` attribute to `V2Page`
      (`packages/ui/src/v2/V2Page.tsx`), matching #309's shape exactly (same prop name, same
      default, same attribute), switching the body wrapper between `overflow-y-auto` and a
      non-scrolling flex frame. Verify with a component test that `scroll={false}` renders the
      non-scrolling frame and the default renders today's scrolling one.
- [x] 3.3 Add `v2WsRouteFor('plugins/$pluginId', 'V2PluginPage')` to `v2WsRoute.addChildren([...])`
      in `packages/ui/src/router.tsx`. Verify with a route test that `/v2/w/:ws/plugins/:pluginId`
      renders `V2PluginPage`.
- [x] 3.4 Add a component test for `V2PluginPage` covering: the not-found state for a workspace that
      doesn't load the plugin; the iframe rendering with the correct `src` for one that does; a
      bridge `request` message being proxied and answered; a `..`-relative or absolute-path request
      being rejected without an HTTP call; `stylesheet` then `theme` messages being posted to the
      iframe once on mount, and `theme` again (with no repeated `stylesheet`) when the theme value
      changes (assert the actual posted messages and their order, not just that `postMessage` was
      called); the page title showing the plugin's `name` when present and its `id` when not.

## 4. V2 rail and nav

- [x] 4.1 Add `'plugin'` to `V2GlyphName` (`packages/ui/src/v2/nav.ts`) and a CSS-shape recipe for it
      in `V2_GLYPH_STYLE`, distinct from every existing glyph. Verify `V2Glyph` (`v2/Glyph.tsx`)
      renders it without a `default` fallback branch being hit.
- [x] 4.2 Add a `case 'plugins': return \`plugin:${second}\`;` to `activeNavKey`
      (`packages/ui/src/v2/nav.ts:77-133`), following the existing `case 'p':` shape. Verify with a
      unit test: `/v2/w/acme/plugins/notes` returns `'plugin:notes'`.
- [x] 4.3 Add `useWorkspacePlugins(ids: readonly string[]): Record<string, WorkspacePlugin[]>` to
      `packages/ui/src/api/hooks.ts`, mirroring `useWorkspaceProjects` exactly (a `useQueries` map
      over `qk.workspace(id)`/`api.ws(id, '')`, `staleTime: Infinity`), filtered to entries with
      `loaded && hasPage`. Verify with a unit test: two workspace ids, each with a different loaded-
      plugins list, produce a correctly keyed map, and an id with none produces an empty array, not
      an error.
- [x] 4.4 In `V2Shell.tsx`'s `WorkspaceGroups`, call `useWorkspacePlugins(ids)` at the point
      `useWorkspaceProjects(ids)` is already called, and render one `v2-row` per workspace's plugin
      entries after that workspace's projects block, using the `plugin` glyph and the plugin's `name`
      when present (else its `id`, task 2.5) as the label, href `/v2/w/${w.id}/plugins/${p.id}`,
      highlighted via `activeNavKey`. Do this without editing `V2_WORKSPACE`/`V2_KEPT`/any
      `rail: boolean` flag VS-384 may have introduced by the time this lands — the plugin rows are
      appended render output, not a static-array entry.
- [x] 4.5 Add the same per-workspace plugin rows to the collapsed 48px rail's per-workspace loop and
      to the phone More list's per-workspace group, alongside their own existing analogous per-
      workspace content.
- [x] 4.6 Verify with a component test: two workspaces with different single-plugin lists each show
      only their own plugin's row (expanded rail, collapsed rail and the More list), the row links to
      the right `/v2/w/:ws/plugins/:id` address, and it is the only row `aria-current` on that route.
      Verify a workspace with no loaded plugin with a page shows no plugin row anywhere, and that
      `V2_EVERYWHERE`/`V2_WORKSPACE`/`V2_KEPT`-derived rows are otherwise unchanged.

## 5. SDK resolves as a bare import from outside the monorepo

- [x] 5.1 **Revised at apply time:** implemented via `module.registerHooks()`
      (`packages/server/src/register-plugin-sdk-hook.ts`) rather than the originally-planned
      `module.register()` + a separate file loaded by URL. `registerHooks()` (Node ≥22.15/23.5,
      within this repo's floor) runs the hook synchronously in the same realm, so no second
      physical file is needed and there is no dist-vs-source path mismatch between production and a
      test run against sources (the `module.register()` draft hit exactly that mismatch — see the
      commit history). `resolvePluginSdk` (typed `node:module`'s own `ResolveHookSync`) returns
      `{ url: pathToFileURL(createRequire(import.meta.url).resolve('@weave-ai/plugin-sdk')).href,
      shortCircuit: true }` for the exact specifier `@weave-ai/plugin-sdk`; every other specifier
      falls through to `nextResolve` unchanged.
- [x] 5.2 `registerPluginSdkResolveHook()` (same file) registers once at daemon startup, before
      `startDaemon()` runs (`packages/server/src/bin.ts`), guarded by a module-level flag so a
      repeated call cannot stack a second hook. Verified with a unit test mocking `node:module`'s
      `registerHooks`, asserting exactly one call across two invocations, and a fresh registration
      after the test-only reset.
- [x] 5.3 Add an integration test (`packages/server/test` or similar) that: writes a temporary plugin
      file to a directory with **no** `node_modules` at all, containing `import { definePlugin } from
      '@weave-ai/plugin-sdk'; export default definePlugin({ id: 'out-of-tree', version: '0.0.0',
      apiVersion: 1, register() {} });`, loads it through the daemon's real plugin-loading path (with
      the resolve hook registered, per the harness's own scratch-daemon setup — never the real CLI or
      live credentials), and asserts it loads successfully (`ctx.plugins.loaded` shows `loaded:
      true`). Also assert an existing in-tree example plugin still loads unchanged.
- [x] 5.4 Update `examples/plugins/notes/package.json`: change `@weave-ai/plugin-sdk` from
      `"workspace:*"` to `"peerDependencies": { "@weave-ai/plugin-sdk": "*" }`, so it resolves purely
      through the loader hook (task 5.1-5.2), the same path a real out-of-tree plugin uses, rather
      than relying on pnpm's workspace symlinking. Verify the existing plugin-loading tests that use
      `examples/plugins/notes` still pass with the hook registered in their harness.

## 6. `@weave-ai/plugin-sdk` publishes to public npm as a self-contained package

- [x] 6.1 Update `packages/plugin-sdk/package.json`: add `"files": ["dist"]`, `"repository"` (this
      repo), `"publishConfig": { "access": "public" }`; keep `"license": "AGPL-3.0-only"`,
      `"exports"`/`"types"`/`"main"` as they are.
- [x] 6.2 Add a `build:publish` step to `packages/plugin-sdk`'s `package.json`/build tooling: after
      `tsc -b` emits `dist/index.d.ts` (which still references `@weave-ai/runtime-sdk`/`channel-sdk`/
      `surface-sdk`/`shared` types), run a `.d.ts` bundler (`dts-bundle-generator` or an equivalent
      rollup-plugin-dts pass) over it, inlining every referenced type from those four packages into a
      single self-contained `dist/index.d.ts`, so the published package has zero `@weave-ai/*`
      dependency. Do not change `pnpm build`/`pnpm typecheck`'s own use of project references — this
      step runs only for publishing.
- [x] 6.3 Verify the bundle is genuinely self-contained: `npm pack` the package into a temp directory,
      `npm install` the resulting tarball into a fresh scratch project outside this repository (its
      own minimal `package.json` + `tsconfig.json`, no access to this monorepo's `node_modules`),
      write a one-line sample importing `definePlugin`/`PluginHost`-typed values from
      `@weave-ai/plugin-sdk`, and run `tsc --noEmit` against it: zero errors, and confirm (e.g. via
      `tsc --traceResolution` or inspecting the resolved path) that the import resolves entirely
      inside the installed tarball, not back into this repository. `npm pack`/`npm install` of a local
      tarball touch no registry and need no token — safe to run directly. Discard the scratch project
      after.
- [x] 6.4 Add `.github/workflows/publish-plugin-sdk.yml`: triggers on `push: tags: ['plugin-sdk-v*']`;
      `pnpm install --frozen-lockfile`, `pnpm --filter @weave-ai/plugin-sdk build`, the `build:publish`
      bundling step (task 6.2), then `npm publish --access public` (add `--provenance` and
      `permissions: { id-token: write, contents: read }` if the runner supports it), authenticated via
      an `NPM_TOKEN` repository secret (`actions/setup-node`'s `registry-url` + `NODE_AUTH_TOKEN`
      pattern). Do not add the secret, do not run `npm publish`, and do not push a `plugin-sdk-v*` tag
      — the workflow is written and left for a human to trigger.

## 7. Docs and example

- [x] 7.1 Update `docs/PLUGINS.md` with the styling principle stated explicitly, near the top of its
      page/styling section, close to verbatim: *the plugin SDK is independent of Weave's styling — a
      plugin uses a small, versioned vocabulary of classes and attributes; the daemon generates the
      actual stylesheet from V2's own CSS and pushes it live, so a Weave restyle reaches every
      installed plugin with no plugin rebuild or republish.* Then document: the V2 page and its
      address; the vocabulary (`WEAVE_PLUGIN_CLASS`, `data-theme`, `data-tone`) with no CSS in the SDK;
      that a plugin using only the vocabulary and the standard bridge client script needs no CSS of
      its own; `host.themeCss()` as an optional first-paint inline returning the identical generated
      stylesheet; the published-package install path (`peerDependency` + `devDependency` on
      `@weave-ai/plugin-sdk`, satisfied at runtime by the loader hook and at type-check time by an
      ordinary `npm install`); and the release steps (tagging `plugin-sdk-v*` triggers the publish
      workflow). Keep `apiVersion: 1` and note existing plugins are unaffected. Quote
      `examples/plugins/notes`'s actual source for code samples, not hand-typed prose.
- [x] 7.2 Rewrite `examples/plugins/notes/index.js`'s `pageHtml()` to use only the vocabulary
      (`WEAVE_PLUGIN_CLASS.section`/`.table`/`.badge`/etc.) for its markup and the standard bridge
      client script — no inline `<style>` block of its own beyond, optionally, `host.themeCss()` for
      first paint. Verify it still loads and its page still renders end to end through the bridge
      (task 5.4's harness), fully styled with no plugin-authored CSS.
- [x] 7.3 Rewrite `docs/PLAN.md` §17's relevant lines to reflect `themeCss()`, the V2 route/rail, and
      the loader-hook/type-delivery story, linking to `docs/PLUGINS.md` as before.
- [x] 7.4 Verify every new code sample added to `docs/PLUGINS.md` type-checks against the shipped
      `@weave-ai/plugin-sdk` types (quoting `examples/plugins/notes/index.js` directly, or a scratch
      `tsc --noEmit` run, discarded after) — record which method was used in the PR description, per
      this project's existing convention for this doc.

## 8. Knowledge

- [x] 8.1 Append to the project's `plugins` knowledge document (`weave_knowledge_note`, doc:
      `plugins`): where the loader hook lives and why it's a `module.register()` hook rather than a
      filesystem symlink or `NODE_PATH`; that the plugin styling contract is a versioned, visual-
      value-free vocabulary (`WEAVE_PLUGIN_CLASS`) backed by CSS the daemon generates from
      `packages/ui/src/v2/v2.css` at its own startup and pushes over the bridge — never a hand-kept
      literal, never shipped in the npm package — so `themeCss()`/`kitCss()` stay two separate host
      methods; and that `@weave-ai/plugin-sdk` publishes to public npm with its `.d.ts` bundled
      self-contained, never the other three SDK packages.

## 9. Full verification

- [x] 9.0 Every test invocation in this section runs as `XDG_CONFIG_HOME="$(mktemp -d)" pnpm ...`
      (per the weaver's 2026-09-14 safety steer): on `main` since VS-376, `daemon-stop.test.ts`
      defaults to the real `systemctl --user stop weave-ai.service` runner and isolates only
      `XDG_STATE_HOME`, not `XDG_CONFIG_HOME`. Never run a bare `pnpm test`/`vitest` in this worktree
      until that is fixed elsewhere. If a test fails only because of this isolation gap, report it
      with the output rather than editing or skipping it in this branch.
- [x] 9.1 `XDG_CONFIG_HOME="$(mktemp -d)" pnpm lint && XDG_CONFIG_HOME="$(mktemp -d)" pnpm typecheck
      && XDG_CONFIG_HOME="$(mktemp -d)" pnpm test` all green; paste both the core/server and the UI
      suite blocks in the delivery report (never just one, never summed).
- [x] 9.2 Rendered check (per the ticket's acceptance and the plan review): open the `notes` example
      through the V2 route, dark and light, desktop and phone width, **side by side with a real V2
      screen's section, table, badge, button and input** (e.g. `Workspace.tsx`'s settings card for
      section/form-row/input, `Work.tsx`'s ticket rows for badge, `DecisionCard.tsx` for button, a
      `HistorySection`/`PullRequestsSection`-style list for the table shape). List every visual
      difference found in the report and either fix it or explain why it's expected (e.g. `.v2-table`
      is a generalized recipe, not a retrofit of those exact screens). Confirm the theme toggle
      repaints the plugin page live with no reload. **Propagation proof**: on a scratch daemon (task
      9.3's setup), edit one token value in that checkout's `packages/ui/src/v2/v2.css`, restart the
      scratch daemon, reload the plugin page with no change to the plugin's own files, and confirm the
      new value appears — screenshot both states.
- [x] 9.3 Scratch-daemon-only manual check (per the ticket's acceptance and this project's hard
      rules): load a copy of the `notes` example placed outside the repository, on a scratch daemon
      with its own `--config-dir` and a non-default port, recording its PID; confirm the plugin loads
      (via the resolve hook) and its page is reachable from the V2 rail. Stop the scratch daemon only
      by its recorded PID after confirming its command line names that same `--config-dir`. Never
      touch the live daemon, a real systemd unit, or port 7433.
- [x] 9.4 Re-read the ticket's Tests and Acceptance sections line by line and confirm each item has a
      corresponding passing test or documented manual check added above. Found and fixed one real gap:
      the notes example's page had four inline `style="..."` attributes (padding/margin/gap), which
      directly violated "a plugin page written to the vocabulary needs no CSS of its own" — restructured
      it to use only `WEAVE_PLUGIN_CLASS` (a `.v2-form-row` for each control row, no wrapping div beyond
      the vocabulary's own), dropped the redundant in-page `<h1>Notes</h1>` (the host's own V2Page title
      bar already shows it), re-verified by a scratch-daemon screenshot check in both themes/widths.
      Added tests closing three coverage gaps the re-read surfaced: `plugin-sdk/src/vocabulary.test.ts`
      (the vocabulary carries no colour/spacing/radius/font value — a drift guard for
      `WEAVE_PLUGIN_CLASS`/`WEAVE_PLUGIN_CLIENT_JS` themselves, complementing `v2-theme.test.ts`'s
      guard on the generated stylesheet), a V2 wrong-source-message-ignored test in
      `v2pluginpage.test.tsx` (V1 already had one), and a V1 no-stylesheet/theme-message regression
      test in `pluginpage.test.tsx`. Also fixed `v2shell.test.tsx`'s plugin-rail test, whose title
      claimed to cover "the More list" but never opened it — it now does. Remaining line items are
      either genuinely manual-only by the ticket's own design (the propagation proof, the
      scratch-daemon load) or narrow, low-risk gaps recorded in the delivery report rather than
      further expanding scope (packed-tarball install and the vocabulary's peerDependency field are
      one-off/structural facts, not standing tests; cookie isolation is a browser guarantee jsdom
      cannot exercise).
