## 1. Bound the worker page frame and pin its header

- [x] 1.1 In `packages/ui/src/v2/WorkerPage.tsx`, render `V2Page` with `scroll={false}` in `V2WorkerPage`, so the page body is the fill variant (`flex min-h-0 flex-1 flex-col overflow-hidden`) and the frame is bounded from `.v2-root` down. Verify: a `V2WorkerPage` render shows `[data-v2-page-body="fill"]` and `overflow-hidden`, not `overflow-y-auto`
- [x] 1.2 In `WorkerBody`, keep every fixed row (status header, failure/option/restart/error bands, `Tabs`, handover band, composer) `flex-none` and make the tab body the only `overflow-y-auto` element: render the Brief tab and the ticket-run `WorkerFeed` branch each in their own `min-h-0 flex-1 overflow-y-auto` region, and render the session feed as the region itself. Verify: for a persistent session the page root contains exactly one `overflow-y-auto` element, and it does not contain the header row

## 2. The session conversation follows the newest turn

- [x] 2.1 In `SessionThreadFeed` (`WorkerPage.tsx`), own the transcript scroller: wrap the rows in a `relative flex min-h-0 flex-1 flex-col` container with `ref={stick.scrollRef}` on a `data-v2-session-scroll` child whose classes are `flex min-h-0 flex-1 flex-col overflow-y-auto`, and drive it with `useStickToBottom(signal, { exact: true, ready: !history.isLoading })` where `signal` reflects the conversation's row count and the live run's state. Keep the existing `ol[aria-label]` and the `SessionTurn`/notice rendering unchanged. Verify: `v2worker.test.tsx` session-feed tests still pass and the `ol[aria-label] > li` ordering test still finds the turn between its human messages
- [x] 2.2 Render the bottom sentinel (`<div ref={stick.bottomRef} />`) at the end of the scrolled content and a `ScrollToBottomButton` (`packages/ui/src/components/ScrollToBottom.tsx`) when `!stick.atBottom`, wired to `stick.toBottom`. Verify: a component test with the shared hook mocked asserts the control appears when the hook reports not-at-bottom, activating it calls `toBottom`, and it is absent while at the bottom
- [x] 2.3 Remove the dead `bottom` ref from `WorkerBody` (`const bottom = useRef...` and `<div ref={bottom} />`) now that the scroller's own sentinel replaces it. Verify: `pnpm typecheck` is clean and no reference to `bottom` remains

## 3. The shared Sheet gains an opt-in non-scrolling, bounded panel

- [x] 3.1 In `packages/ui/src/components/Sheet.tsx`, add `bodyScroll?: boolean` (default `true`). When `false`, the panel is `flex max-h-[calc(var(--ac-app-h)*0.8)] flex-col` and the body is `flex min-h-0 flex-1 flex-col overflow-hidden p-4` instead of `ac-scroll max-h-[calc(var(--ac-app-h)*0.7)]`; the body keeps its sentinel/DOM contract otherwise. Verify: `settingsOpenspec`/`settings` sheet tests and the remove/move project tests stay green (default path unchanged), and a focused test renders `bodyScroll={false}` and asserts the body does not carry `ac-scroll`
- [x] 3.2 Add focus restoration to `Sheet`: remember `document.activeElement` at the moment the sheet opens and refocus it when it closes/unmounts (guarding a detached element and a `null` active element). Verify: a test opens a sheet from a button, closes it, and asserts focus is back on the button

## 4. The ticket modal pins its header and scrolls only the feed

- [x] 4.1 In `packages/ui/src/v2/ticket/TicketModal.tsx`, pass `bodyScroll={false}` to `Sheet` and restructure the panel into a `flex min-h-0 flex-col` column: the identity block (identifier row with Open ticket and close, title, worker line, `LiveActivityLine`) as `flex-none`, then the feed region `relative flex min-h-0 flex-1 flex-col` holding a `data-ticket-modal-scroll` `ac-scroll` element with `min-h-[20rem]` and a bottom sentinel. Keep `data-ticket-modal` on the outer column so the existing tests and selectors keep working. Verify: within `[data-ticket-modal]` the identifier row is not inside the feed scroll container, and the feed container is the only `overflow-y-auto`
- [x] 4.2 Render the loading `SkeletonRows` and the not-found `ErrorState` inside the feed region (so the panel holds its size from loading to loaded), and keep the title wrapping in the pinned block (`flex-none`, wrapping permitted) while the feed keeps its floor. Verify: a test asserts the skeleton renders inside the scroll container, and a long-title render keeps the feed scroll container present with the title above it
- [x] 4.3 Mark the close control `data-autofocus` so focus lands on a dismissible control on open, and confirm Escape and backdrop click still close (unchanged). Verify: the existing `ticketModal.test.tsx` cases for Escape, close control, backdrop and not-found still pass

## 5. The modal's feed follows live output

- [x] 5.1 Drive the feed scroller with the shared `useStickToBottom(signal, { exact: true })` — the same hook and mode as the chat and the session page — rendering `ScrollToBottomButton` when `!stick.atBottom`; `signal` reflects the feed length and the live turn's output size. Do not add a second measurement of the feed. Verify: a test with the shared hook mocked asserts the jump-to-latest control renders when not at bottom, calls `toBottom` on activation, and is absent at bottom
- [x] 5.2 Confirm no scroll chaining: the page behind is held by `useDismiss`'s `body.overflow = hidden`, the backdrop does not scroll, and the feed scroller keeps `overscroll-behavior: contain` (via `ac-scroll`). Verify: a test asserts the feed scroller carries the `ac-scroll` class, and the rendered evidence confirms the page behind does not move while the feed is scrolled

## 6. Regression tests

- [x] 6.1 Add a test that renders `V2WorkerPage` (not `WorkerBody` alone) for a persistent session and asserts the bounded root: `[data-v2-page-body]` is the fill variant, the header row (`data-v2-worker`'s first header child) is outside the transcript scroll container, and the page root holds exactly one `overflow-y-auto` element. Confirm it fails against the pre-change layout (`scroll` default) and passes after. Verify: run once with `scroll={false}` reverted to confirm the failure, then restore
- [x] 6.2 Add a test in `packages/ui/src/test/ticketModal.test.tsx` that fails on the old structure: the pinned identity header is outside the only `overflow-y-auto` element inside `[data-ticket-modal]`, and the feed region is that element. Confirm it fails before 4.1 and passes after. Verify: `pnpm vitest run packages/ui/src/test/ticketModal.test.tsx` is green
- [x] 6.3 Keep the VS-616 assertion in `v2worker.test.tsx` (`[role="log"]` is null) correct: the new session scroller (`data-v2-session-scroll`) is the one scroller, so add a comment naming it and assert it is the only one. Verify: the session tests are green
- [x] 6.4 Confirm follow/pause coverage still holds: `packages/ui/src/test/stickToBottom.test.tsx` passes unchanged against the shared hook, and state in the report that both new scrollers reuse it rather than a new measurement. Verify: `pnpm vitest run packages/ui/src/test/stickToBottom.test.tsx packages/ui/src/test/v2worker.test.tsx packages/ui/src/test/ticketModal.test.tsx` is green

## 7. Other surfaces on the same route and the shared Sheet

- [x] 7.1 Verify the ordinary ticket-run worker page pins the same way and its shared `WorkerFeed` keeps its own bounded `role="log"` box inside the tab body; verify the Brief tab scrolls inside the region with the header pinned. Verify: `v2feed.test.tsx` and `v2worker.test.tsx` are green
- [x] 7.2 Check every `Sheet` user (the ticket modal and the two settings sheets) and confirm the shared-level change does not regress them. Verify: the settings sheet tests pass, and `git diff --stat` names only `WorkerPage.tsx`, `Sheet.tsx`, `TicketModal.tsx` and the test files (no unrelated V2 page changed)

## 8. Verification

- [x] 8.1 `openspec validate vs-629-persistent-session-page-anchor-the-heade --json --strict` is clean before requesting review
- [x] 8.2 `pnpm lint && pnpm typecheck` green
- [x] 8.3 Run one full suite at a time with `--maxWorkers=4`: the core/server suite and the UI suite, each in its own invocation. Paste both suite blocks verbatim in the report, separately, without adding them together

## 9. Rendered evidence and closing

- [x] 9.1 Capture with a real browser against the built app (per `docs/ui-screenshot-harness.md`; a throwaway harness under `packages/ui`, removed before commit), in both themes at desktop (1440px) and phone (390px) width:
  - a long session transcript scrolled to the middle with the header still visible, and the same with the live activity row showing;
  - the ticket modal with a long feed scrolled to the middle and its header visible, and the modal with a live turn running.
  Verify: each capture is backed by an in-browser DOM-geometry probe (document not scrollable, exactly one scroller, header visible at the top while scrolled to the middle, live row present)
- [x] 9.2 State the comparison against the weaver chat in the report: the session page and the modal use the same shared `useStickToBottom` follow and `ScrollToBottomButton` as `ChatConversation`, with the same pinned-header/single-scroller shape; note the differences (the worker page carries `V2Page`'s 38px frame header above the worker header, and a ticket-run worker's `WorkerFeed` keeps its own bounded box)
- [x] 9.3 Attach every capture to the ticket with `weave_ticket_attachment_put` so it appears on the approval card; `git status --porcelain` is empty in `work/` (captures live in the home directory outside the worktree)