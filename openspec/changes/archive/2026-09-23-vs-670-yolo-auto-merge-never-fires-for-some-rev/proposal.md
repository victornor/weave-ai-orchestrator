## Why

VS-665's `merge_approval` was reviewed by the weaver on 2026-09-22 (`concerns` 14:37Z, `looked` 14:45Z) on a project with YOLO on, with green CI and a clean, mergeable pull request — and it never resolved. It posted neither the "auto-merge is waiting" comment nor the approval, and sat `open` for 9+ hours. Three sibling cards reviewed in the same session all resolved within seconds. The one visible difference: VS-665's ticket row had `project_id` NULL (it was filed with only an assignee role, the bug [VS-668](weave://tickets/VS-668) fixed), and the YOLO machinery resolves the mode from the ticket's own project.

So the auto-approval machinery is *ticket-centric*: a ticket whose row project is null is silently invisible to the merge sweep and to the mark-time grant, and nothing else surfaces the stuck card. There is no safety net that starts from the decision, so this class of failure sits silent for hours.

## What Changes

- Resolve a ticket's project for YOLO through the same place its other readers do: its own `projectId` when set, otherwise the project of its assignee role. A role-assigned ticket is never treated as project-less, so a stale null row no longer hides it from the auto-approval path.
- Add a **decision-centric** safety sweep, run beside the merge sweep on the supervisor tick. It scans open `plan_approval`/`merge_approval` decisions that carry the weaver's review and have been open past a short threshold, on a project where YOLO is on; it grants a `looked` card that has no other periodic grant path (a plan, or an archive-backfill merge) and surfaces anything still unresolved once — a system comment naming the card and elapsed time, plus a wake to the weaver — with a once-per-card guard, so a reviewed card can no longer sit silently.
- State, in the PR, that VS-665 self-corrects at `weave daemon upgrade` (the `0062` backfill from VS-668 fills its project, and the role fallback grants its card without waiting), so no manual nudge is needed for it.

## Capabilities

### New Capabilities

<!-- None: this changes how an existing capability resolves and guards its grants. -->

### Modified Capabilities

- `human-decisions/auto-approval`: how a ticket's project is read when deciding whether YOLO is on (own project, else the assignee role's project), and a new requirement that a reviewed-but-unanswered auto-approval is caught and surfaced.

## Impact

- `packages/core/src/tickets/service.ts` — a project-resolution helper used by `yolo()`, the merge sweep's policy lookup and the approval-head resolution; a new `staleReviewSweep()` and its once-per-card surface.
- `packages/core/src/api.ts` — declare the new sweep on `TicketsService`.
- `packages/core/src/supervisor/index.ts` — call the sweep on the tick beside `autoMergeSweep`, guarded so test stubs that omit it are unaffected.
- Tests: `packages/core/src/tickets/yolo.test.ts` (the role fallback) and a new `packages/core/src/tickets/stale-review-sweep.test.ts` (the safety net), plus the supervisor tick wiring.
- No HTTP, CLI or tool shape changes. No new config key; the threshold is a module constant.
- Depends on VS-668 only for the already-merged backfill; the code fix here is independent of it and covers any row whose project was not (or cannot be) backfilled.
