## Why

Daemon settings are not workspace-scoped, yet the only door to them is inside a workspace: the
operator picks an arbitrary workspace, opens its settings, and flips a "This workspace / This
daemon" switch in the top right. Captain asked (2026-09-11) for a global settings entry in the
sidebar, for workspace settings to drop the daemon/workspace switch entirely, and for both pages to
say plainly which scope they configure. The data model in `packages/ui/src/lib/settings.ts` already
tags every section with its area in one table, so this is navigation and presentation, not
modelling.

## What Changes

- **New daemon settings route `/settings`** — a root-level route, sibling of `/needs` and `/live`,
  rendering only the daemon-area sections (Updates, Models, Dictation, Security & Devices, This
  device). It needs no workspace.
- **Workspace settings slimmed** — `/w/$ws/settings` renders only the workspace-area sections
  (Workspace, Projects, Models, Channels, Presentation, Scheduled tasks). The area switcher
  (the "This workspace / This daemon" segmented control) is removed from both pages.
- **A settings entry in the sidebar's global block** — `GLOBAL_NAV` gains Settings → `/settings`,
  alongside Needs you, Live, Chats, Incidents and Map. The workspace rail's Settings entry stays,
  now going to workspace settings only.
- **Scope stays legible** — the workspace page's header names its workspace; the daemon page's
  header says it applies to every workspace.
- **Old links keep working** — a workspace-settings URL naming the daemon area or a daemon section
  redirects to `/settings` with the same section; a daemon URL naming a workspace section redirects
  to the remembered workspace's settings. Deep links into any section keep working from both entry
  points.
- **Announcement retargeted** — the rail's and More sheet's update entries, and the phone update
  banner, open the Updates section on `/settings`.
- **Copy that named the removed switch** ("Set in This daemon → Models") re-pointed at the daemon
  settings destination. No setting changes behaviour; the sections table is unchanged.
- **Decisions recorded**: `device` stays in the daemon area under its own label; the daemon page's
  models section no longer borrows a workspace's models as its inherit preview; push on the daemon
  page addresses the browser's remembered workspace (the push API is workspace-scoped).

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `web-settings/settings-scopes`: the two-areas-one-page model becomes two destinations — a
  workspace settings route showing only workspace sections and a daemon settings route at
  `/settings` showing only daemon sections — with the URL contract, the fallback behaviour, the
  scope-labelling requirements and the phone reachability rewritten around the two routes.

## Impact

- `packages/ui/src/routes/Settings.tsx` — split into `WorkspaceSettingsRoute` (workspace sections)
  and `DaemonSettingsRoute` (daemon sections); switcher removed; scope meta added.
- `packages/ui/src/router.tsx` — new root-level `/settings` route with `beforeLoad` redirects; the
  workspace settings route gains the mirror redirect.
- `packages/ui/src/lib/settings.ts` — table untouched; a per-route section resolver and a pure
  redirect decider added alongside `resolveSettingsLocation`.
- `packages/ui/src/app/nav.ts` (`GLOBAL_NAV`, `MORE_ITEMS` hint), `app/AppShell.tsx`
  (`onGlobalPage`, update entry), `app/MoreSheet.tsx` (update entry), `app/WorkspaceNav.tsx`
  (unchanged), `api/hooks.ts` (a workspace-optional `useModels`), `lib/push.ts` (unchanged; called
  with the remembered workspace on the daemon page).
- Tests: `settingsScopes`, `settings`, `updates`, `appshell`, `moreSheet`, `router` updated to pin
  the two-route behaviour, the redirects and the retargeted announcement links.
- No daemon/server changes; no API changes.
