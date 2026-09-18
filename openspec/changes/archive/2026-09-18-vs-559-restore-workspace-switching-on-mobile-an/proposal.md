## Why

On a phone the V2 app offers no way to change workspace. V2 was promoted to `/` (VS-456) and V1 —
whose `MoreSheet` carried an explicit **Workspaces** section ("the bottom bar addresses the active
workspace only, so this is where the others are reached on a phone") — was retired and then deleted
(VS-457), but the V2 phone shell never grew an equivalent: every workspace group in the rail is
`md:`-only and the More list lists only the current workspace's sections. Separately V2 still renders
an **Open V1** row in that More list, and it now points back at V2 itself, since V1 answers no URL.

## What Changes

- **Restore workspace switching on mobile.** Add a **Workspaces** group to the V2 phone More list
  listing every workspace the daemon reports, each row carrying the workspace's name and its open
  Needs-you count and switching the app to that workspace. The current workspace is marked. From any
  screen this is two taps: **More**, then the workspace row.
- **Remove the V2 → V1 affordance.** Delete the `Open V1` row from the V2 More list. Audit every
  other V2 surface (shell, settings, menus, footers) for a control or link that sends the user to V1
  and remove it too; leave V1's route modules and the retired-address redirects untouched.
- **Make it non-regressable.** Add a UI test that renders the phone shell, opens More and finds and
  exercises the workspace switcher (and asserts the V1 row is gone).
- **Rendered evidence.** Capture the switcher open at phone width in light and dark, and a desktop
  capture showing the V1 row gone; attach them to the ticket.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `web-v2/navigation`: the phone More list gains a Workspaces group that switches workspace, reachable
  in at most two taps from any screen.
- `web-v2/shell`: V2 offers no control that switches the user back to V1.

## Impact

- `packages/ui/src/v2/V2Shell.tsx` — `MoreList` gains the workspace rows and loses `Open V1`.
- `packages/ui/src/test/v2shell.test.tsx` — the phone-More tests.
- No daemon, HTTP API, config or migration change. No change to V1's modules or the retired-address
  redirect table in `router.tsx`.
