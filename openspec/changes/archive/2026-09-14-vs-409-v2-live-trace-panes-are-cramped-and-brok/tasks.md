# Tasks — VS-409

## 1. The pane's box and its scroll range

- [x] 1.1 `packages/ui/src/components/RunTranscript.tsx`: accept a `maxHeight` prop (the caller's
      cap) so the transcript's scroll element and its parent agree on one height, and a `follow`
      prop (default `live`) so a pane opened to watch a finished run still opens at its newest line.
- [x] 1.2 `packages/ui/src/v2/WorkerFeed.tsx`: the body is always `overflow-hidden` and bounded by
      exactly one height — the caller's `bodyHeight`, the compact pane's height, or the page
      transcript's 420px cap — so the last line is reachable at every width.

## 2. Watch opens doubled and follows

- [x] 2.1 The compact pane's opening height is 264px (double the old 132px).
- [x] 2.2 The pane passes `follow` to `RunTranscript` so it opens at its newest output and follows;
      scrolling up pauses the follow (`useStickToBottom`, unchanged).

## 3. No live Refresh, reconnect when dropped

- [x] 3.1 Remove the always-on `Refresh` button from the chrome.
- [x] 3.2 Show a `Reconnect` control (wired to `retryNow`) only while the run stream is dropped.

## 4. Roles expands any worker with a ticket

- [x] 4.1 `packages/ui/src/v2/RolesPage.tsx`: a worker row expands in place when it is running **or**
      has a ticket; only a worker with neither opens its page.
- [x] 4.2 The expanded row shows that worker's newest run trace.

## 5. A corner resize grip on every expandable pane

- [x] 5.1 `WorkerFeed` renders a corner grip when `resizable`: pointer drag, up/down arrows,
      double-click reset, clamped between the minimum and most of the viewport.
- [x] 5.2 `DecisionCard`'s Watch feed and `RolesPage`'s worker pane both pass `resizable`.

## 6. Tests

- [x] 6.1 Update `packages/ui/src/test/v2feed.test.tsx` for the 264px compact box; add tests for no
      Refresh while live, Reconnect when dropped, the grip drag/reset, and the 420px page cap.
- [x] 6.2 Update `packages/ui/src/test/v2roles.test.tsx` — a worker with a ticket expands even when
      not running; a worker with no ticket opens its page — and assert the grip renders.
- [x] 6.3 `packages/ui/src/test/v2decisions.test.tsx`: the Watch pane renders a resize grip.

## 7. Verify

- [x] 7.1 `pnpm lint`, `pnpm typecheck` green.
- [x] 7.2 Both suites run and pasted verbatim.
- [x] 7.3 Rendered before/after evidence of Watch, Roles and the dropped-stream pane; dark and light;
      desktop and phone; a pane scrolled to its true bottom and the grip mid-drag. Captured on a Vite
      dev server with the real V2 components and CSS (fetch/EventSource stubbed), not a scratch
      daemon — see the ticket report for why and where the images are.
