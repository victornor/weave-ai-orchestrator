# Tasks — VS-411

## 1. Needs you badge counts only actionable cards

- [x] 1.1 Add a pure predicate (in `packages/ui/src/v2/needsCount.ts`) that treats an open human
      decision as actionable unless its kind carries weaver review and its `weaverReviewStatus` is
      `unseen`; `looked` and `concerns` count.
- [x] 1.2 `useV2Counts` derives `needs`, `needsByWs` and `needsGlobal` through that predicate, so the
      global and per-workspace rail badges and the header pill all agree. The Needs you page's own
      list stays untouched.
- [x] 1.3 Tests: `v2needsCount.test.ts` covers the rule; `v2shell.test.tsx` covers both badges
      (global and per-workspace); `v2needs.test.tsx` proves the page still lists an excluded card.

## 2. Live → Needs you navigates every time

- [x] 2.1 Cause named and fixed: the V2 route guard's auth probe (`v2Refused` → `GET /api/auth/me`)
      re-ran on every navigation and the router did not commit the new match until it answered, so
      the URL changed and the body stayed on the previous screen. `v2Refused` now keeps a signed-in
      result for the page load, so a later navigation never blocks on another probe.
- [x] 2.2 A repeated scripted browser run lands every time, including while Live tiles stream:
      Live ↔ Needs you 120/120, Live → every other rail destination 78/78, plus a streaming stress
      run 0 failed / 150.

## 3. Work scrolls sideways

- [x] 3.1 Kanban and table scroll horizontally on a window narrower than all their columns: every
      column reachable by trackpad, shift+wheel and a visible scrollbar. Cause: `.ac-scroll` on each
      column contained overscroll on both axes, so a sideways gesture over the cards never chained
      to the kanban; `overscroll-x-auto` restores the chain. Phone list unchanged.
- [x] 3.2 `v2work.test.tsx` covers the kanban scroller and its chaining, and the table's overflow
      container. Verified in a real headless Chromium: a horizontal wheel over a card scrolls the
      kanban (scrollLeft 0 → 300); the table scrolls 274.

## 4. Every kanban column the same fixed width (captain, 2026-09-14)

- [x] 4.1 Every column is `flex: 0 0 236px` (one shared width) whether empty or full; no column
      grows into free space and none narrows because it is empty. Replaces VS-387's
      narrow-empty-column rule.
- [x] 4.2 On a wide window the spare width stays empty to the right; on a narrow one the board
      scrolls (item 3). Phone list unchanged.
- [x] 4.3 Tests: all six columns share one fixed width, including an empty column beside a
      populated Done.
- [x] 4.4 Screenshots at desktop width, both themes: only Done populated, and mixed columns.

## 5. Verify

- [x] 5.1 `pnpm lint`, `pnpm typecheck` green.
- [x] 5.2 Both suites run and pasted verbatim.
- [x] 5.3 Scratch-daemon screenshots: badge before/after a weaver mark, Work at a narrow desktop
      width scrolled to its last column, both themes. Navigation repeat run output pasted.
