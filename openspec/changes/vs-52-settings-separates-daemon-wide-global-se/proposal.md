## Why

The web app's Settings page is one flat tab strip — Workspace, Projects, Conductor, Channels,
Presentation, Security & Devices, Notifications, Updates — served from a workspace URL
(`/w/:ws/settings`). Three of those tabs are not workspace settings at all: Updates and Security &
Devices read and write daemon-level state through root routes, and the theme picker and the
notification toggles are stored in this browser's `localStorage`. Presenting them beside the
workspace's own name, YOLO mode and knowledge budgets implies every workspace carries its own copy,
which is wrong and now actively confusing: this daemon holds several workspaces, and an operator who
changes their password or queues an upgrade from workspace A has changed it for every workspace.

## What the sections actually are

Investigated against `main` at `fe2142e`. Each existing section, where its data lives, and the scope
that follows from it:

| Section (today) | Data lives in | Read/write through | Scope |
|---|---|---|---|
| Workspace — name, ticket prefix | `workspace.yaml` | `GET /api/w/:ws`, `PATCH /api/w/:ws/config` | workspace |
| Workspace — theme | `localStorage` `conductor.theme` (`packages/ui/src/lib/theme.ts`) | nothing | **device** |
| Workspace — workspaces list | daemon `workspaces.yaml` | `GET /api/workspaces` | daemon data, used as workspace navigation |
| YOLO mode | `workspace.yaml` `defaults.yolo` | `PATCH /api/w/:ws/config` | workspace |
| Knowledge budgets | `workspace.yaml` `defaults.knowledgeBudgetTokens`, `defaults.bootstrapBudgetTokens` | `PATCH /api/w/:ws/config` | workspace |
| Projects | workspace database + `workspace.yaml` | `/api/w/:ws/projects` | workspace |
| Conductor | the workspace's conductor agent | `/api/w/:ws/conductor` | workspace |
| Channels — Telegram | `workspace.yaml` `channels` | `PATCH /api/w/:ws/config` | workspace |
| Presentation | `workspace.yaml` `presentation` (`packages/server/src/presenter.ts:20`) | `/api/w/:ws/presentation` | workspace |
| Security & Devices | the daemon's auth store | `/api/auth/*` (root) | daemon — one operator account, one device list, for every workspace |
| Notifications — toggles | `localStorage` `conductor.notifs` | nothing | **device** |
| Notifications — push subscription | the workspace database `push_subscriptions` | `POST /api/w/:ws/push/subscriptions` | device, registered per workspace |
| Updates | the daemon's release state | `/api/daemon/update`, `/api/daemon/upgrade` | daemon |

Runtimes (`GET /api/runtimes`) are daemon-level too, but they are read-only input to the Projects and
Conductor selects rather than a setting, so they stay where they are used.

## What Changes

- Settings gains a top-level **area** dimension with exactly two areas, chosen in a segmented control
  in the page header: **This workspace** and **This daemon**. The existing tab strip below it shows
  only the sections of the selected area, so every section lands in exactly one area.
  - **This workspace** — Workspace, Projects, Conductor, Channels, Presentation. Each writes
    `workspace.yaml` or the workspace database through `/api/w/:ws/...`. The workspaces list stays in
    the workspace area, at the top of the Workspace section: it is how you leave for another
    workspace, not a daemon setting you edit. This is where VS-46's phone workspace list lands.
  - **This daemon** — Updates, Security & Devices, and a new **This device** section. Updates and
    Security & Devices are daemon state reached through root routes and are labelled as applying to
    every workspace on this daemon.
- The per-device settings become their own section rather than being scattered: **This device**
  holds the theme picker (moved out of the Workspace section, where it was mislabelled as workspace
  state) and the existing notification toggles, under a caption saying plainly that they are stored
  in this browser only — not on the daemon and not in any workspace. Its contents are otherwise
  unchanged. It sits in the daemon area because, like the daemon's own settings, it is the same
  whatever workspace you are looking at; the section's own label is what says "device", so the page
  still has exactly the two areas the request asks for.
- The URL carries both: `?area=workspace|daemon&section=<key>`, kept in sync with `replace: true`,
  the same idiom `BoardRoute` already uses for `?done=`/`?project=`. A link that names only a section
  (`?section=updates`) resolves its area from the section key, so the sidebar update entry filed
  alongside this ticket can link by key alone. Unknown or absent values fall back to the area's first
  section rather than rendering nothing.
- Existing section keys are unchanged (`workspace`, `projects`, `conductor`, `channels`,
  `presentation`, `security`, `updates`), so no existing link breaks. `notifications` becomes
  `device` — nothing links to it today, because the section was not addressable before this change.
- No section is redesigned, no setting is added or removed, and nothing changes about where the
  daemon or a workspace stores its configuration.

## Capabilities

### New Capabilities
- `web-settings/settings-scopes`: how the web app's Settings page separates daemon-wide settings from
  per-workspace settings and from per-device browser state — the two areas, which section belongs to
  which, how a section is labelled when it is neither daemon nor workspace, that daemon-level state
  reads the same from every workspace, and the URL contract that makes an area and a section
  deep-linkable.

### Modified Capabilities
None. `daemon-upgrade/upgrade-surfaces` requires the web app to *have* a section showing the update
state and offering the upgrade; that requirement is unchanged by which area the section is filed
under, and the navigation indicator it specifies is untouched.

## Impact

- `packages/ui/src/routes/Settings.tsx` — the area/section model, the header switcher, the URL
  binding, the theme field moving into the new device section. The section components themselves are
  moved, not rewritten.
- `packages/ui/src/test/settings.test.tsx` and `packages/ui/src/test/updates.test.tsx` — both reach
  their section by clicking a tab label, so both need the area switch; new tests cover both areas
  rendering, the deep link, and the fallback for an unknown section.
- No server, core, CLI or database change. No API change: the daemon-level query keys in
  `packages/ui/src/api/keys.ts` (`['daemon','update']`, `['sessions']`, `['me']`, `['workspaces']`)
  are already workspace-free, and the `QueryClient` is created above `WorkspaceProvider` in
  `packages/ui/src/main.tsx`, so daemon state is already one cache entry shared by every workspace.
  This change adds the tests that hold that property in place.

## Out of scope, found while investigating

The Notifications section posts its push subscription to `/api/w/:ws/push/subscribe`
(`Settings.tsx:695`), but the route the daemon serves is `/api/w/:ws/push/subscriptions`
(`packages/server/src/push.ts:31`). The 404 is swallowed by the surrounding `catch`, so enabling push
always reports "Push is not available". It is a real defect, unrelated to the scope split, and is
left for the conductor to file rather than fixed here.
