## Why

VS-28 gave the daemon an update check and a full Updates section in Settings, but the only thing the navigation says about it is a 1.5px dot on the Settings rail item (`packages/ui/src/app/AppShell.tsx`, driven by `showsUpdateIndicator`). The workspace owner reports that this does not read as anything: the dot names nothing, says nothing about what the update is, and getting to the upgrade means clicking Settings and then finding the Updates tab — which is the eighth of eight tabs. On a phone there is no signal at all, because the dot lives on a rail that is hidden below `md`.

Two things stand in the way of a direct route. The Settings section is local `useState` (`Settings.tsx`), so there is no way to address a section at all — nothing can link to Updates. And an upgrade that has been queued leaves the navigation showing "an update is available", which is no longer the useful thing to say once one is already running.

## What Changes

- **The daemon's release state becomes one derived entry, not a dot.** `updateEntry(status, upgrade)` in `packages/ui/src/lib/upgrade.ts` answers with `null`, an `available` entry naming the ref and target commit, or an `upgrading` entry naming the stage the upgrade is in. An upgrade in flight wins over an available update.
- **The desktop rail shows that entry as a self-contained block** above the workspace switcher: the title, the target it would move to, and an "Open Updates" affordance. The whole block is a link to Settings with the Updates section selected. It is absent when the daemon is up to date, when checking is not configured, and when the check failed.
- **The dot on the Settings rail item is gone.** One fact gets one entry.
- **A Settings section is addressable by URL** — `/w/:ws/settings?section=updates`. The section is looked up **by key**, so an unknown or missing key falls back to the first section and a reshuffle of the tabs cannot strand a link. The tabs keep switching on the click and write the chosen key back into the URL, preserving whatever else the search carried.
- **The phone gets the same signal**: a badge on the More tab, positioned out of flow exactly like the Needs-you count so the bar geometry is untouched, plus an entry at the top of Settings that opens the Updates section. That entry is phone-only and is hidden once Updates is the section being shown, so no viewport ever shows the fact twice.

## Capabilities

### New Capabilities

(None.)

### Modified Capabilities

- `daemon-upgrade/upgrade-surfaces`: what the web app's navigation announces about the daemon's release — a named entry that routes to the upgrade rather than an unnamed indicator, and what it says while an upgrade is in flight.

## Impact

- `packages/ui/src/lib/upgrade.ts` — `UpdateEntry`, `updateEntry` and `updateEntryLabel`; `showsUpdateIndicator` stays and is what `updateEntry` is built on.
- `packages/ui/src/app/AppShell.tsx` — reads `useDaemonUpgrade` alongside `useDaemonUpdate`, renders the rail block, drops the dot, passes the entry to the bottom bar.
- `packages/ui/src/app/BottomBar.tsx` — an optional `update` prop badges the More tab.
- `packages/ui/src/app/link.tsx` — `useSearchParams`, the loosened search read that matches the loosened `A`.
- `packages/ui/src/routes/Settings.tsx` — the section comes from the URL and is written back to it; the phone entry sits above the section body.
- `packages/ui/src/test/{appshell,bottombar,updates,settings,runtimeselect}.test.tsx` — new coverage for the entry, the badge and the deep link; the route tests that mock `../api/hooks` and `../app/link` wholesale gain the exports the routes now reach for.

## Out of scope

- How updates are detected, requested, or applied: the daemon side, the HTTP surface and the Updates section's own contents are untouched.
- A version number for the target. The daemon reports a ref and a commit, not a version, so the entry names those; inventing one would mean changing the check, which this ticket excludes.
- The terminal UI and the CLI, which announce updates their own way.
