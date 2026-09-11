## Why

A scheduled task remembers only its last fire instant. Captain asked (2026-09-11) to see every fire
and what came of it, on a daemon-level page, rather than hunting through one workspace's Settings.
VS-220 already records each fire as a conductor run; VS-230 already split settings navigation. What
is missing is the page and the join, not a second store.

## What Changes

- **A daemon-level Scheduled page** at `/scheduled`, sibling of `/live` and `/chats`, listed in the
  sidebar's global block. It lists every workspace's routines, each attributed to its workspace,
  with schedule, next run, created-at, fire count, and per-fire history.
- **History is the existing run join**, the same correlation VS-220's spend rollup already uses:
  wakes with `source = 'routine'` and a matching `routineId`, joined to the conductor run (status,
  summary, timestamps). No fire-history table. A new read on the workspace routines API exposes
  that list and a lifetime fire count. When that run's claimed wakes (flattened, including
  coalesced bundles) include anything besides this routine, the fire is labelled that the run also
  handled other work, so the turn summary is not read as solely this fire's account.
- **Create and edit from the page.** Pause, resume and remove stay. The conductor MCP tools and
  `conductor routine …` are unchanged.
- **The workspace Settings section gives way to the page.** Two editors for the same records is a
  maintenance cost with no reason to pay it: captain asked for a page of their own, creation
  already exists, and a workspace-scoped view is a filter on the same page (`?ws=`). Old
  `?section=scheduled` links redirect there rather than 404.
- **Firing is untouched.** Re-arm, missed-fire, overlap and action policy stay as VS-220 specified.

## Capabilities

### New Capabilities

- `routines/global-page`: a daemon-wide Scheduled page over every workspace's routines, reachable
  from the sidebar's global block and the phone More menu, with create/edit on the page, each row
  attributed to its workspace, and empty/loading/partial-failure states in the Global Live shape.

### Modified Capabilities

- `routines/definitions`: captain configures routines from the Scheduled page, not from a workspace
  Settings section; listing, adding, pausing, resuming, editing and removing are offered there.
- `routines/conductor-outcome`: each routine's fires are listed from existing run records (when it
  ran, the run's status, the conductor's summary); a shared turn is labelled; spend continues to
  show on the same page.
- `web-settings/settings-scopes`: scheduled tasks leave the workspace settings area; a leftover
  `?section=scheduled` link redirects to the Scheduled page.
- `workspace-navigation/sidebar-workspaces`: the global block, the phone More menu, active-section
  marking, and provider-less rendering all include the Scheduled page.

## Impact

- `packages/core/src/routines` — `list()` grows a lifetime `fireCount`; a `fires(id)` read returns
  the wake→run join. `fireDue` / `onRunFinalized` / schedule math are not edited.
- `packages/server/src/routes/routines.ts` — `GET /routines/:id/fires`. Existing CRUD unchanged.
- `packages/shared` — fire DTO (`sharedTurn` included); optional `fireCount` on list items.
- `packages/ui` — new `/scheduled` route (AppShell, no WorkspaceProvider); `GLOBAL_NAV` +
  `onGlobalPage`; `useRoutinesMany` fan-out like Global Live; Settings loses the Scheduled section
  and `SETTINGS_SECTIONS` drops `scheduled`; old section links redirect.
- Tests: core fires-join and unchanged firing cases; HTTP fires endpoint; ui page, nav, settings
  redirect, and the existing firing suite still green.
- No new migration. No MCP or CLI change.
