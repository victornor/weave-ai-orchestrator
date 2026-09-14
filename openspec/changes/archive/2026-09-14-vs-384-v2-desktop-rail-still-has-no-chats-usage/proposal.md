# V2 desktop rail: Chats, Usage and Changelog

## Why

V2's desktop rail has no Global Chats view, and no Usage or Changelog under a workspace, so those
screens are reachable only through the phone More list. They were put in the rail by VS-352 and
captain decided V2 keeps them, but the rail half of #307's commit `6a18e806` was reverted by
`42f96499` before the squash, so `b4a4d14f` on `main` does not carry it. Re-files VS-373, which was
cancelled on the belief that #307 had covered it.

## What Changes

- `packages/ui/src/v2/nav.ts`: mark the kept V1 screens that belong in the desktop rail (`Chats`,
  `Usage`, `Changelog`) with a `rail` flag and derive two rail lists from the existing registries —
  `V2_RAIL_EVERYWHERE` (the global rows plus Chats, after Live as in V1) and `V2_RAIL_WORKSPACE`
  (the workspace sections plus Usage and Changelog). The knowledge sub-pages stay More-only.
- `packages/ui/src/v2/V2Shell.tsx`: render the expanded rail and the collapsed 48px rail from the
  two rail lists, so Chats appears in Everywhere and Usage and Changelog under every workspace
  group. The phone tab bar and the More list keep reading `V2_EVERYWHERE`/`V2_KEPT`.
- Highlighting needs no change: `activeNavKey` already maps `/v2/chats`, `/v2/w/<ws>/usage` and
  `/v2/w/<ws>/changelog` to `global-chats`, `ws-usage` and `ws-changelog`, and the existing one-row
  rule covers them once the rows exist.
- Tests: assert both rail lists, and in the shell that both desktop rails carry the three entries,
  each links to the right `/v2` address, and each is the only highlighted row on its route.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `web-v2/navigation`: the rail's Everywhere group also carries Chats and a workspace group also
  carries Usage and Changelog, in both the expanded and the collapsed rail.

## Impact

Frontend only, in `packages/ui/src/v2`. No daemon route, API, config or migration. V1 at `/` is
untouched, as are the screens' bodies; this only adds rail rows that already have routes and
`activeNavKey` mappings. The change is deliberately narrow around `V2_KEPT` so it merges cleanly
with PR #309 (VS-371), which is still open against the same file; when #309 lands it removes the
knowledge sub-pages from `V2_KEPT`, and the derived rail lists (which never carried them) are
unaffected.
