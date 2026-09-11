## Why

Approving an `action_approval` does not take the operational ticket out of
`repairApprovals()`'s scan, so the next supervisor tick treats the now-`answered`
decision as missing and raises a fresh card. Captain keeps approving; the card
keeps coming back. **Each of those re-raised cards, when approved, wakes the
worker with `decision_answered`.** The daemon does not execute the host action
itself, but nothing in the daemon or the worker contract treats a second approve
of the same `action` revision as already authorised — a worker following
VS-216's procedure will run the commands again. This is a safety-gate failure
in the direction of granting more authority, not just UI noise.

## What Changes

- `repairApprovals()`'s operational branch distinguishes **lost** from
  **answered**: it re-raises only when the current `action` revision has no
  `action_approval` in `open` or `answered` targeting that revision. An
  answered approve or revise is not missing.
- Approving therefore no longer re-raises. A genuinely stranded ticket (action
  document present, no open or answered card for that revision) is still
  repaired, still without YOLO.
- A later `action` write (revise-and-resubmit) still raises a fresh card for
  the new revision, as `putDocument` already does.
- Worker contract: a wake that is another `approve` of an `action` revision
  already covered by a `report` is not a second authorisation to run.
- Plan and merge repair branches are **not** changed. Their status filters
  (`proposed` / `in_review`) are load-bearing; the finding is recorded in
  design.md.
- Release note: anyone stuck in the live loop can **reject** the card (cancels
  the ticket). That remains the destructive workaround, not the fix.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `human-decisions/approval-integrity`: the operational repair must not treat
  an answered `action_approval` as missing; a lost approval for the current
  `action` revision is still repaired; a new revision still gets a new card.

## Impact

- `packages/core/src/tickets/service.ts` — operational branch of
  `repairApprovals()`.
- `packages/core/src/tickets/tickets.test.ts` — answer-then-repair, stranded
  repair, revise-and-resubmit; existing "none open" stranded case stays valid
  as the lost path.
- Worker skill / `definitionOfDone('operational')` / brief table: do not
  re-execute an already-reported action revision.
- No schema, API, or status-graph change. VS-216's "approve leaves
  `in_progress`" stands.
- Immediate mitigation until this lands: reject the looping card.
