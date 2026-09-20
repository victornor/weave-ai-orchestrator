## Why

The rail's counts are stale while the app is on a workspace page. The rail counts every workspace,
but a workspace page holds only that one workspace's event stream — the daemon-wide stream is
mounted only on global pages (`V2Shell.tsx`'s `fanIn = !ws && !path.startsWith('/chats')`). A worker
that starts or finishes in another workspace therefore never invalidates the rail's per-workspace
worker queries, and the count corrects itself only when a page such as Live mounts the same queries
again. Captain reported exactly that: "It might show one next to Live, and then I click Live and it
updates to two."

## What Changes

- The shell holds the one daemon-wide multiplexed stream (`FanInStreams` → `GlobalEventStream`) on
  every signed-in page, not only global ones, so every workspace's events invalidate the rail's
  counts wherever the rail is shown. This is the existing VS-509 connection — one per document,
  independent of workspace count — not a new per-workspace stream and not polling.
- The rail's Live figure and the Live floor's `N running` figure are computed by one shared
  derivation, so the badge and the page cannot disagree by construction.
- Needs you gets the same live correction for the same cause (its decision events now reach the rail
  on a workspace page). Incidents is stated as deliberately out of scope: the daemon emits no
  incident event, so it cannot lag "the same way".

## Capabilities

### New Capabilities

_(none)_

### Modified Capabilities

- `web-v2/navigation`: the rail's counts stay current on every page — the shell holds the
  daemon-wide stream, so a count that spans workspaces is invalidated by every workspace's events.
- `web-v2/live`: the rail's Live badge and the Live floor's roster figure come from one shared
  derivation; the badge counts the same set the floor labels running, across workspaces and through
  the between-turns handover grace.

## Impact

- `packages/ui/src/v2/V2Shell.tsx` — mount the daemon-wide stream on every signed-in page.
- `packages/ui/src/v2/V2Page.tsx`, `packages/ui/src/v2/LivePage.tsx`, and a shared count helper —
  one derivation for the Live badge and the floor figure.
- UI tests only. No server, shared, schema, route, API or migration change; the connection-budget
  test stays green (the daemon-wide stream is still one connection, and no per-workspace fan-out is
  added).