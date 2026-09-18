## Why

Captain, 2026-09-18: eleven "Approve the spec archive for VS-…" merge cards appeared in Needs you for Fernwood tickets that were already `done`. They came from the reconciliation sweep's archive backfill (VS-389), which opens a draft archive pull request for a finished ticket's leftover OpenSpec change and raises a human `merge_approval` for it. That is housekeeping for work the human already shipped: nobody should be asked to approve it, and the weaver cannot dismiss a `merge_approval`.

## What Changes

- The daemon lands an archive-backfill pull request itself, as a system landing, through the same project-serialized archive-then-merge machinery it already uses. No `merge_approval` decision is created for it, so nothing appears in Needs you.
- The reconciliation sweep drives the landing on every pass while the archive pull request is pending, replacing the card-approval trigger; pending checks, a stale branch and standing failures keep their existing retry/record-once behaviour.
- An archive card already open (raised before this change) is withdrawn by the sweep and its pull request landed the same way, so the existing strays clear without a human.
- The merge-time archive (VS-327 archive-then-merge) is unchanged and still raises no card.
- The card-raising requirements are removed from the `ticket-delivery/openspec-archival` spec; the YOLO/weaver-review gate no longer applies to archives because there is no card.

## Capabilities

### New Capabilities
None.

### Modified Capabilities
- `ticket-delivery/openspec-archival`: an archive-backfill pull request is landed by the daemon with no human card; the sweep converges landings and withdraws legacy open cards.

## Impact

- `packages/core/src/supervisor/index.ts` (reconcile), `packages/core/src/tickets/service.ts` (`mergeDone` backfill call site, `raiseArchiveBackfillCard`), `packages/core/src/decisions/service.ts` (archive-card answer path kept only for legacy cards).
- Tests: `archive-backfill.test.ts`, `supervisor.test.ts`.
- Out of scope: closing the open Fernwood archive PRs by hand, Fernwood branch flow, VS-568.
