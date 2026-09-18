# Tasks

## 1. The plan tab surface

- [x] 1.1 `packages/ui/src/v2/PlanModal.tsx`: lift the modal's body into a plan-tab surface that
  renders the focused plan with no overlay, no `role="dialog"`/`aria-modal`, no **Plan** header, no
  project tag strip and no inner plan tab list. It keeps the planner conversation, the drafts aside
  and **Submit**, and every draft operation: edit title/description/kind/priority/target role,
  reorder, tier override, scout dispatch and dispatched state. Verify: the ported
  `v2planmodal.test.tsx` (renamed for the tab surface) exercises the draft operations against the new
  component and no test asserts a modal/dialog.
- [x] 1.2 The plan tab's conversation renders through the shared `ChatConversation` exactly like the
  weaver chat — message list, turn summary naming "Planner", live working trace, markdown, attachment
  rows, stick-to-bottom — with weaver-only extras (inline decision cards, dispatch chips, reply
  control, unattributed-worker row) omitted, and `resolveContext` resolving the planner model's
  window as today. Verify: a `v2plantab`/`v2chat` test mounts a plan with a run trace and asserts the
  turn summary renders, and that no decision card or reply control appears.
- [x] 1.3 The plan tab's composer keeps the shared `ChatComposer` — attach, dictate and send, with
  `showScope={false}`, `sharedDictation={false}` and the hotkey only when the tab is focused — and
  posts to the plan's planner thread. Verify: a test sends from a plan tab and asserts the post goes
  to the plan's thread with no project field.
- [x] 1.4 Drafts layout is kept: a right-hand drafts aside on a desktop-sized viewport and a
  within-tab conversation/drafts switch on a phone, so the draft list is never unreachable. Verify: a
  test at a phone-width container shows the switch and reaches the draft list; a desktop-width
  container shows both together.

## 2. The chat tab strip

- [x] 2.1 `packages/ui/src/v2/ChatPage.tsx`: render a tab strip above the chat content carrying the
  weaver tab first and, after it, one tab per `drafting` plan in the workspace — every project's,
  each tagged with its project. Fetch the plans with one existing `usePlans(projectId)` query per
  project (`useQueries`) and merge them, since there is no workspace-wide plans endpoint. Selecting
  a tab renders the weaver chat for the weaver tab and the plan tab surface for a plan tab;
  **New plan** creates a plan and focuses its tab; submitting or discarding a plan drops its tab and
  focuses another. Verify: a `v2chat`/`v2plantab` test with plans in two projects asserts one tab per
  plan with each project's tag, switches tabs with neither plan changed, and asserts submitting one
  closes only its tab.
- [x] 2.2 **New plan** creates in the chat composer's selected project: the per-thread draft's
  `projectId`, with `Auto` defaulting to the workspace's first project. Changing the scope changes
  only where the next **New plan** lands and does not create, discard or re-scope an existing plan.
  Verify: a test changes the composer's project and asserts a subsequently created plan's `projectId`
  is the new scope and that no existing plan changed.
- [x] 2.3 Last-focused tab is remembered per workspace/device, including the weaver tab; on load the
  remembered plan is focused when still drafting, otherwise the strip falls back to another plan or
  the weaver tab. Verify: a test focuses a plan, remounts, and asserts the same tab is focused; a
  second test removes the remembered plan and asserts the fallback; a third asserts focusing the
  weaver tab is remembered.
- [x] 2.4 Remove the composer's plan entry point: `ChatComposer`'s `onOpenPlan` prop and **Plan**
  button, and `ChatPage`'s `planOpen` state, `onOpenPlan`, and the `PlanModal` usage/overlay. Verify:
  `v2chatcomposer`/`v2chat` tests no longer find a **Plan** button and `pnpm typecheck` passes.
- [x] 2.5 The strip scrolls horizontally at narrow widths and never wraps; the **New plan** control
  sits outside the scroller so it stays reachable; tab titles, rename and delete live on the strip
  (delete asks for confirmation and discards only that plan). Verify: a phone-width test asserts the
  scroller and the pinned **New plan** control, and a test renames and deletes a tab.

## 3. Checks and rendered evidence

- [x] 3.1 `pnpm lint`, `pnpm typecheck` and `pnpm test` green from `work/`; paste **both** suite
  blocks (core/server and UI) verbatim, never summed and never one presented as both.
- [x] 3.2 Rendered captures, in light and dark at desktop and phone width, of the weaver tab and two
  plan tabs open together: before/after for the change, showing the strip, a focused plan tab, the
  draft list and **Submit**, and no modal. Attach them to the ticket with
  `weave_ticket_attachment_put` (not a path), and open each to confirm it shows what was intended.
  `git status --porcelain` in `work/` is empty before review.
