## Context

Today one route, `/w/$ws/settings`, serves both areas: a `Segmented` radio pair ("This workspace" /
"This daemon") in the page header switches `area`, and `Tabs` lists `sectionsOfArea(area)`. Area and
section both live in the search (`?area=&section=`), resolved by `resolveSettingsLocation`
(`packages/ui/src/lib/settings.ts`), which lets a section key alone decide its area. The sections
table (`SETTINGS_SECTIONS`) tags all eleven sections with their area and stays untouched.

The rest of the app already has a daemon-level tier: five root-level routes (`/needs`, `/live`,
`/chats`, `/incidents`, `/map`) listed in `GLOBAL_NAV` at the top of the sidebar, wrapped in
`AppShell` without a `WorkspaceProvider`. The shell is workspace-optional (`useOptionalWorkspace`);
workspace-scoped queries key off `useHookWs()`, which returns `''` and disables the query when no
provider is present.

Two daemon-area sections currently reach into workspace state and would break on a provider-less
page:

- `DaemonModelsSection` calls `useModels()` → `useWs()`, which **throws** outside a provider. It
  uses the workspace's models only as the inherit-preview/seed for a daemon overlay (VS-207), a
  nicety designed for when the page lived inside a workspace.
- `DeviceSection` calls `useWs()` for web push. The push API is genuinely workspace-scoped
  (`PUSH_ROUTES` mount under `/api/w/:ws`; `lib/push.ts` stores the subscription id per workspace in
  localStorage), so "this device" push always addressed some workspace.

## Goals / Non-Goals

Goals: two destinations with their own routes; no area switcher; unmistakable scope; old links
redirect rather than 404; sections table unchanged.

Non-Goals: no redesign of any section's contents; no change to what any setting does; no change to
the daemon/server; no third "device" area or route; no redesign of the phone's More menu structure
beyond the one new entry.

## Decisions

### D1 — Daemon settings get a root-level route; workspace settings keep theirs

`/settings` (sibling of `/needs`, wrapping `<AppShell><DaemonSettingsRoute/></AppShell>`, no
`WorkspaceProvider`) shows only daemon sections. `/w/$ws/settings` shows only workspace sections.
`Settings.tsx` exports both components; they share the section bodies, which are area-pure already.

Alternative considered: one route component with an `area` prop — rejected, it keeps the two scopes
entangled at the exact seam the ticket asks to split, and the shell's global-page handling
(`onGlobalPage`) keys off the path anyway.

### D2 — Redirects are decided by a pure function, applied in `beforeLoad`

`lib/settings.ts` gains `redirectForSettingsRoute(area, search)`, a pure decider returning either
"stay" or `{ to, search }`; both routes' `beforeLoad` call it and `throw redirect(...)`. Pure, so
the redirect contract is unit-tested without a router harness (the ui tests have no memory-history
harness today; `router.test.tsx` asserts on the route tree structurally).

The contract:

- Workspace route + daemon area/section → `/settings` with `{...search, section}` (`area` dropped;
  `?area=daemon` alone resolves to the daemon area's first section, `updates`). Other search params
  pass through, as section rewrites do today.
- Daemon route + a *known workspace* section → the remembered workspace's
  `/w/$ws/settings?section=...` (`getWorkspaceId()` — the same remembered id `AppShell` uses). With
  no remembered workspace: stay, showing the daemon page's first section — there is nothing else to
  show and onboarding owns that browser state. Only an explicitly named workspace section triggers
  this; the default (no params) must not, or the fallback would redirect-loop.
- Unknown section anywhere → no redirect; the route falls back to its own first section (existing
  behaviour, kept by `resolveSettingsLocation`).

In-page section selection keeps writing back with `replace: true` and the rest of the search
preserved, minus `area`, which the URLs no longer carry.

### D3 — Scope in the page header, words from the areas table

`PageHeader` already has a `meta` slot. Workspace settings: title "Settings", meta
"This workspace · {workspace name}" (name from `useWorkspaceSummary`, falling back to the route
param). Daemon settings: meta "This daemon · applies to every workspace". The labels come from
`SETTINGS_AREAS`, so the table stays the one source of the scope vocabulary. The `Segmented`
switcher is deleted from both pages.

### D4 — `device` stays in the daemon area, its label doing the work

"This device" is not daemon state, but it is also not per-workspace, and the daemon settings page is
precisely "the settings that are not a workspace's". Moving it to a third area would reintroduce a
three-way switcher this change exists to remove. Its section label and its own copy ("stored in this
browser only") carry its true scope, and the page meta names the daemon as the page's scope. This is
the recorded decision; `settingsScopes.test.tsx` pins the placement.

### D5 — The daemon page's two workspace borrowings are cut deliberately

- **Models inherit-preview (VS-207):** the daemon page stops consulting a workspace. `hooks.ts`
  gains `useModelsOptional()` — the same query keyed off `useHookWs()`, disabled when empty — and
  `DaemonModelsSection` uses it. On the daemon page the inherit hint reads "each workspace uses its
  own setting" (no "below"), and filling an override seeds from the runtime default rather than a
  workspace's current value. Alternative considered: feed it the remembered workspace — rejected,
  it would put an arbitrary workspace's values into a daemon-wide page, the exact arbitrariness the
  ticket removes.
- **Push in `DeviceSection`:** push cannot be cut — the workspace settings no longer host a device
  section, so hiding the toggle would silently strip the only UI that can turn push off. The section
  addresses the browser's remembered workspace (`getWorkspaceId()`), which is where this device's
  existing subscription already lives (`subscriptionId(ws)` reads the per-workspace localStorage
  key). When the browser remembers none, the push block renders its off state with a one-line
  explanation that push subscriptions are registered per workspace. `lib/push.ts` itself is
  unchanged.

### D6 — Navigation and the announcement

- `GLOBAL_NAV` gains `{ key: 'global-settings', label: 'Settings', to: '/settings', glyph: 'more',
  hint: 'This daemon — applies to every workspace' }`, last. It renders in the desktop rail's global
  block and the More sheet's global block automatically.
- `RAIL`/`TABS` are untouched: the workspace Settings entry (kbd `,`) now leads to workspace
  settings only. `MORE_ITEMS`' Settings hint drops the daemon mention ("This workspace").
- `AppShell.onGlobalPage` gains `/settings` — it is a global page (no workspace marked active,
  `FanInStreams` mounted like the other global pages so the rail's badges stay live).
- The rail's and More sheet's update entries link `/settings` + `?section=updates` (still by key, so
  `daemon-upgrade/upgrade-surfaces`' "addressed by section rather than by position" holds). The
  phone update banner at the top of the workspace settings page navigates to the same address; on
  the daemon page it stays hidden while Updates is the section shown.

### D7 — Copy that named the switch

Three strings reference the removed area switcher and are re-pointed (in scope, presentation of
settings): `lockedHint` "Set in This daemon → Models" and `WorkerOptionsEditor`'s disabled hint →
"Set in the daemon settings → Models"; `DaemonModelsSection`'s intro "disable the matching This
workspace → Models fields" → "…workspace Models fields".

### D8 — Tests

- `settingsScopes.test.tsx`: the area-model and table-integrity tests stand; the page tests split
  per destination; the switcher assertions become absence assertions; new tests pin the redirect
  decider (`redirectForSettingsRoute`) case by case, `device`'s placement, and both metas.
- `settings.test.tsx`: imports the two route components; workspace sections resolve against
  `WorkspaceSettingsRoute`, dictation/device against `DaemonSettingsRoute`.
- `updates.test.tsx`: deep-link and URL-write tests move to the daemon page (no area radio; the
  URL carries `section` only); the phone-banner tests assert the navigation to `/settings`.
- `appshell.test.tsx` / `moreSheet.test.tsx`: announcement hrefs become `/settings`; the More menu's
  global block asserts the new Settings entry.
- `router.test.tsx`: asserts the root-level `settings` route exists alongside `w/$ws`.

## Risks / Trade-offs

- [Stale bookmark/bookmarked `/w/ws/settings?area=daemon` links] → redirected by D2; the redirect is
  pinned by test.
- [Daemon models' inherit-preview loses its per-workspace seeding on the daemon page] → accepted
  (D5): the preview was a nicety for a page that lived inside a workspace; the control itself is
  unchanged and the workspace pages keep everything.
- [Push semantics on the daemon page depend on the remembered workspace] → matches where the
  subscription already lives; the alternative (hiding the toggle) is a regression, and a
  workspace picker is out of scope.
- [`resolveSettingsLocation` retained but partly bypassed by the per-route resolver] → it stays the
  redirect decider's engine (section→area lookup, fallback), so the "section wins over area" rule
  keeps one implementation.

## Migration Plan

Pure web-app change; no data, API or daemon involvement. Ship behind nothing — the old URLs redirect
on arrival. Rollback is reverting the commit.

## Open Questions

None.
