## Why

The V1 ticket page spreads one subject — a single ticket — across five tabs (Overview, Activity,
Work, Usage, Knowledge), so reading a ticket means clicking between panes that the human wants side
by side. Captain asked for the details and the live conversation in one split, with work, usage and
knowledge stacked below it, and Plan kept as a separate tab (2026-09-13). The V2 page is getting the
same shape in VS-346; this change is the V1 half.

## What Changes

- **The tab bar becomes Overview and Plan, plus Artifacts only when the ticket has one.** The
  separate Activity, Work, Usage and Knowledge tabs are removed. Overview stays the default tab; the
  Artifacts tab keeps its present rule (shown only when a published artifact exists, not the
  default).
- **The Overview tab becomes one scrolling page of four rows.** Row 1 is a two-pane split — today's
  Overview content (description, ticket and delivery facts, blockers, its decision) on the left and
  today's Activity content (comment and turn feed, merge decision, composer) on the right, with the
  right pane scrolling on its own. Row 2 is today's Work content, row 3 today's Usage content and
  row 4 today's Knowledge content. Below a sensible width the split stacks, overview first.
- **The page is composed from the existing tab components**, not rewritten: each former tab becomes
  a section component and keeps its data, hooks and behaviour.
- **Links keep landing.** `?tab=` continues to accept `overview`, `plan` and `artifacts`; the old
  values `activity`, `work`, `usage` and `knowledge` map to Overview and scroll to that section where
  practical, and an unknown value falls back to Overview. Every UI link that opened a ticket on an
  old tab was audited; only the pull-request "view" links and the merge card's "Ask the worker" link
  carry `tab=activity`, and they land on the merged Overview's activity pane.
- **Existing actions are unchanged**: replying or steering the worker, approving a merge, retry and
  auto-merge all stay reachable from the merged page and call what they call today.
- **Tests updated**: the tab set, the section order, the old-tab mapping, and the activity composer
  send are covered; tests that clicked the removed tabs are rewritten.

Not a breaking API change: no daemon, route or schema change. Frontend only; `packages/ui/src/v2/**`
is not touched (VS-346 owns it).

## Capabilities

### New Capabilities

- `web-v1/ticket-page`: the V1 ticket page's tab set (Overview and Plan, plus Artifacts when
  published), the four-row Overview layout with its two-pane split, the section order and narrow
  stacking, the `?tab=` alias mapping that keeps old links landing, and the page's kept actions.

### Modified Capabilities

_None. The change composes existing V1 behaviour into one page; the specs those components implement
(e.g. `human-decisions/option-cards`, `ticket-artifacts/viewer`, `knowledge/context-accounting`)
describe the same behaviour and are unchanged._

## Impact

- `packages/ui/src/routes/TicketPage.tsx`: the tab constants and resolver, a new `OverviewTab` that
  composes the section components, and the four former tab components turned into sections.
- `packages/ui/src/test/ticketpage.test.tsx` and `packages/ui/src/test/liveTranscript.test.tsx`:
  updates for the removed tabs and the merged Overview.
- `packages/ui/src/routes/project/PullRequestsSection.tsx` and
  `packages/ui/src/components/DecisionCard.tsx`: audited — they carry the legacy `tab=activity`
  value, which the alias mapping resolves; no route or search-schema change.
- No daemon, API, database or `packages/ui/src/v2/**` change.
