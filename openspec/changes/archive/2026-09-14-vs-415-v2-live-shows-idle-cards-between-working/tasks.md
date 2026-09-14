## 1. Failing tests first

- [x] 1.1 Live floor: a card from ws A hands over (running → active) between two ws B running cards; assert no card that reads idle sits above one that reads working, and that it drops below once the grace elapses (two workspaces, fake timers).
- [x] 1.2 Live floor: a state flip moves a card between groups in the same frame as its label flips.
- [x] 1.3 V2 rail/header: the Live count counts only workers that read working (running), not `active`/`provisioning`, and follows a flip live.

## 2. Fix

- [x] 2.1 `liveOrder.ts`: derived working-state helpers shared by display, sort and count.
- [x] 2.2 `LivePage.tsx`: card status and running-first group from the one state; floor `running` figure counts working shown cards.
- [x] 2.3 `V2Page.tsx` / `V2Shell.tsx`: `live` + `liveByWs` from the same state; header pill scope-aware.

## 3. Verify

- [x] 3.1 UI suite, typecheck and lint green.
- [x] 3.2 Evidence screenshots (stubbed-data harness, both themes, before/after handover).
- [x] 3.3 PR opened with the cause and the verification.
