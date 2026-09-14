# V2 shell fixes: Needs you count, Live → Needs you, Work sideways scroll

Tracker change for [VS-411](weave://tickets/VS-411). A `task` ticket, so this change carries tasks
only — `skip_specs: true`.

## Why

Captain's 2026-09-14 pass over V2 reported three defects in the shell and the Work page:

1. **The Needs you badge is misleading.** The sidebar and header count every open human decision,
   including `plan_approval` / `merge_approval` / `action_approval` cards the weaver has not looked
   at yet. Those cards cannot be answered until the weaver marks them `looked` or `concerns`, so the
   number promises actions captain cannot take.
2. **Live → Needs you is flaky.** From the global Live page, clicking the global Needs you rail entry
   sometimes changes only the URL; the body stays on Live. It recovers on its own, so it is
   intermittent rather than fixed.
3. **Work hides columns on a narrow desktop window.** With the window narrower than the sum of the
   kanban or table columns, Work does not scroll sideways, so the last columns cannot be reached.

## What changes

- **Actionable Needs-you count.** A pure predicate counts an open human decision unless its kind
  carries weaver review (`carriesWeaverReview`: plan, merge, action) and its `weaverReviewStatus` is
  still `unseen`. `looked` and `concerns` both count. Every other kind counts as before. The badge
  reads this figure in both the global and per-workspace rails and the page header; the Needs you
  page's own list is unchanged.
- **Live → Needs you.** Cause: the V2 route guard on `v2RootRoute.beforeLoad` re-runs on every
  navigation and awaits `v2Refused()`, a network probe of `GET /api/auth/me` that was cached for only
  5 s. More than 5 s after the last probe, the router had already committed the new location but did
  not render the new match until the probe answered, so the URL changed and the body stayed on the
  previous screen; it recovered when the daemon answered or the cache rewarmed. Fix: once the daemon
  has answered 200, the browser is treated as signed in for the rest of the page load, so a later
  navigation never blocks on another probe (a 401 from any API call still redirects through
  `api/client.ts`). A repeated navigation check, including while Live tiles stream, lands every time,
  and the other rail destinations reached from Live are checked the same way.
- **Work horizontal scroll.** On a window narrower than all its columns, kanban and table scroll
  horizontally with trackpad, shift+wheel and a visible scrollbar, and every column is reachable. The
  phone list layout is unchanged.
- **Equal kanban columns.** Captain added this (2026-09-14): every column is one fixed width
  (`0 0 236px`) whether empty or full, replacing VS-387's narrow-empty-column rule. A column never
  grows into free space — a board where only Done has cards shows six equal columns, with the spare
  width left empty to the right, and the board scrolls when the columns are wider than the pane.

## Out of scope

- Which cards appear on the Needs you page (only the count changes).
- The Held chip (VS-406, done).
- Trace panes and the Runs page, which are separate tickets.
