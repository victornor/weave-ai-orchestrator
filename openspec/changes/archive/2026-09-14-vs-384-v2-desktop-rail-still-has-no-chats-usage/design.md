# Design — V2 desktop rail: Chats, Usage and Changelog

## Context

See `proposal.md`. The rail is derived entirely from `packages/ui/src/v2/nav.ts`: `V2_EVERYWHERE`
and `V2_WORKSPACE` feed the expanded rail, the collapsed rail and the phone tab bar, while the kept
V1 screens live in `V2_KEPT` and reach only the More list. #307's reverted commit `6a18e806` had
already solved this; its rail half is the starting point.

`activeNavKey` in the same module already maps `/v2/chats` → `global-chats`,
`/v2/w/<ws>/usage` → `ws-usage` and `/v2/w/<ws>/changelog` → `ws-changelog`, and `v2Href` already
builds their addresses in scope. The only missing piece is the rows.

## Goals / Non-Goals

- Goal: Chats, Usage and Changelog are rail rows in both desktop rails, correctly scoped and
  highlighted, with the phone surfaces unchanged.
- Non-goal: any change to `V2_KEPT` membership, to the knowledge sub-pages, or to a screen body.

## Decisions

**Derive the rail lists from `V2_KEPT` rather than duplicating entries.** Add an optional `rail`
flag to `V2Dest`, set it on the three kept screens, and export `V2_RAIL_EVERYWHERE` and
`V2_RAIL_WORKSPACE` built by spreading the existing arrays and filtering `V2_KEPT`. One source per
destination means a row's label, glyph, path and scope cannot drift from the More list's.

*Alternative considered:* a separate hand-written rail array. Rejected — it duplicates each
destination and invites the drift `nav.ts` exists to prevent.

**Keep the change narrow around `V2_KEPT`.** PR #309 (VS-371) is still open against `nav.ts` and
edits `V2_KEPT` by removing `ws-graph` and `ws-explorer`. Adding only a flag to existing entries and
two derived arrays touches different lines, so the two changes merge without conflict; the derived
lists never reference the removed entries.

## Risks / Trade-offs

- [Chats is global but sits in the Everywhere group, which has no workspace scope] → `v2Href`
  already leaves a global destination global; the test asserts `/v2/chats` regardless of the current
  workspace.
- [The collapsed rail interleaves a workspace initial between global and workspace marks] → The
  derived `V2_RAIL_EVERYWHERE`/`V2_RAIL_WORKSPACE` keep that grouping; the Chats mark renders in the
  global stretch and Usage/Changelog in the workspace stretch.

## Migration Plan

Frontend-only, no data or address change. Rollback is reverting the two files.

## Open Questions

None.
