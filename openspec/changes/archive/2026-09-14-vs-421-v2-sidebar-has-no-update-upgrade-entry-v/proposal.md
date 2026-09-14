# V2 sidebar gets V1's update entry, and loses the desktop More row

Tracker change for [VS-421](weave://tickets/VS-421). A `task` ticket, so this change carries tasks
only — `skip_specs: true`.

## Why

Captain, 2026-09-14: "There's no upgrade button on V2 in the sidebar, and there's also a More button
in the sidebar. I don't know why it's there. The More button is for mobile."

Two gaps in the V2 shell:

- **No update entry.** V1's rail (`packages/ui/src/app/AppShell.tsx`) shows a self-contained block
  when the daemon has an update available or an upgrade in flight — a state dot, a title, the target
  or stage, and "Open Updates" — and V2's rail (`packages/ui/src/v2/V2Shell.tsx`) has nothing. The
  fact exists in V2 only inside Settings → Updates, which is not where a human notices it.
- **A phone control on the desktop.** `V2Shell.tsx` renders a `More…` row in the 194px desktop
  `<aside>` unconditionally. More is the phone tab bar's overflow menu; the desktop rail already
  lists every destination More offers.

## What changes

- **One update entry, derived once.** `V2Shell` reads `useDaemonUpdate()` and `useDaemonUpgrade()`
  and calls the same `updateEntry()` / `updateEntryLabel()` from `packages/ui/src/lib/upgrade` that
  V1 uses — no second implementation and no second copy of the states.
- **Expanded rail.** When an update is available or an upgrade is in flight, the rail carries a
  block above the workspace groups with a state dot (needs-you tone when available, merging tone
  while upgrading), the title, the detail line and "Open Updates", linking to V2 Settings → Updates
  (`/v2/settings?section=updates`). Nothing renders when the daemon is up to date.
- **Collapsed rail.** The same entry in compact form: a 30px mark with the state dot and the same
  accessible label, at the top of the 48px rail.
- **Phone.** The More sheet carries the same entry, so a phone can reach it without the desktop rail.
- **The desktop More row goes.** The `More…` button is removed from the `<aside>`; the phone tab
  bar's More button is untouched. Every destination the More sheet lists is already a rail row
  (Everywhere: Needs you, Live, Incidents, Map, Runs, Scheduled, Settings, Chats; workspace: Chat,
  Needs you, Work, Roles, Knowledge, Usage, Changelog, plus project and plugin rows), and the V1
  link More offers is already in the rail footer, so removing the row strands nothing.
- **Tests.** The V2 shell suite asserts the entry appears for available and upgrading and not for up
  to date, that the desktop rail no longer carries a More row, and that the phone tab bar still does.

## Out of scope

- The upgrade flow itself (Settings → Updates) and `UpdatesSection`.
- The V2 icon set (VS-420, done); this change adds exactly one mark, for the update entry.
