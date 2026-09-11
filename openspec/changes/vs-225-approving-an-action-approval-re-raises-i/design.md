## Context

See proposal.md for why. VS-216 added an operational branch to `repairApprovals()`
(`packages/core/src/tickets/service.ts`) that scans `kind = 'operational' AND status NOT IN
('done','cancelled')` and re-raises when `openApproval(id, 'action_approval')` is null. VS-216
also specified that `approve` / `revise` leave the ticket `in_progress`. That combination is
the loop: answering makes the decision not-open, the ticket stays in the scan, the next
supervisor tick (`LIVENESS_EVERY_MS`) raises another card.

`applyActionApproval` (`packages/core/src/decisions/service.ts`) on `approve` only optionally
comments and returns. `answer()` then wakes `askedByAgentId` with source `decision_answered`
(covered by `decisions.test.ts`: "approve leaves the ticket in_progress and wakes the worker").
The daemon never runs the host command. The worker skill / `definitionOfDone('operational')`
says: after approve, execute. There is no "already ran" flag and no check of the `report`
document before that wake. **A worker following the procedure will re-execute on each
repeated approval.** Stopping the re-raise stops the re-authorisation. A leftover queued wake
from the live loop still needs a contractual skip.

Do not reintroduce a status change on approve. That VS-216 decision stands.

## Goals / Non-Goals

**Goals:**

- Repair only a genuinely lost `action_approval` for the current `action` revision.
- Keep stranded-ticket repair and revise-and-resubmit.
- Record the plan/merge-branch assessment.
- Contractual skip so a second approve of an already-reported revision is not another run.

**Non-Goals:**

- Changing plan or merge repair predicates.
- A persisted "action authorised" / "action executed" column.
- Daemon-side observation of host commands.
- Changing `applyActionApproval`'s status behaviour.

## Decisions

### 1. Repair when the current revision has no open or answered card targeting it

In the operational loop, after the existing `openApproval` skip and the `action`-document
existence skip, skip also when any `action_approval` on the ticket is `open` or `answered`
and its `target.revision` equals the current `action` document revision. Then raise, same
shape as today (`raiseActionApproval(..., repaired: true)`), still never YOLO.

Read the decision rows through the same db mapping `targetJson` already uses. Treat a
missing `target` on an `open`/`answered` row as covering the current revision so a
test-or-legacy row without `targetJson` cannot re-enter the loop.

Why this shape, not a ticket flag: the decision row is already the authorisation record.
A new column would have to be written in `applyActionApproval`, cleared on a new
`action` revision, and kept in sync with revise — a second source of truth for something
`target.revision` + `status` already say.

Why not "any `action_approval` has ever existed": a superseded card for revision 1 must
not block repair (or the legitimate raise) of revision 2. Why not "skip only `approve`":
after `revise`, the worker should rewrite `action`, not get another card for the same
revision; `putDocument` raises the next card when they do.

### 2. Plan and merge branches: status filters are load-bearing, leave them

| Branch | Scan | What answering does | Why it does not loop |
|---|---|---|---|
| plan | `status = 'proposed' AND kind = 'change'` | approve → `approved`; revise → `proposing`; reject → cancelled | ticket **leaves the result set** |
| merge | `status = 'in_review' AND NOT auto_merge` | approve → `merging`; changes → `in_progress` | same |
| action | `kind = 'operational' AND status NOT IN ('done','cancelled')` | approve/revise → stay `in_progress` | **does not leave**; that is the bug |

The plan/merge `openApproval` check is only for tickets still in the waiting status. If
approve's transition failed, re-raising a plan card on a still-`proposed` ticket is
recovery. Copying the operational "skip if answered" predicate onto those branches would
hide that failure. Do not change them. Add a comment on the operational branch that
plan/merge terminate by status, and that this branch cannot.

### 3. Re-execution is contractual; add a skip, not a daemon lock

The daemon cannot see a `systemctl`. After this repair fix, the loop no longer mints new
authorisations. Add one sentence to `definitionOfDone('operational')`, the worker skill
operational row, and the brief table: if the wake is `approve` of an `action` revision
that already has a `report`, do not run the commands again. Both `templates/brief.md.tmpl`
and `templates/worker.AGENTS.md.tmpl` (VS-211).

No new MCP tool, no report-document gate on `done` (scouts have none either).

### 4. Tests pin lost vs answered, not the old "none open" wording alone

Keep the existing stranded case (action document, no decision row) as the lost path.
Add:

1. Raise via `putDocument('action')` (so `target` is real), `decisions.answer(..., approve)`,
   `repairApprovals()` twice → no new `decisions.create`, repaired list empty.
2. Same with `revise`, no new `action` write → no new card.
3. After `revise`, `putDocument('action')` again → a new card targeting revision 2.
4. Existing "never wrote action" and YOLO-does-not-answer-repair cases stay.

Do not construct the approve-then-repair fixture by inserting a bare `answered` row
without going through `answer()` / `putDocument` — that would not prove `target.revision`
matching. VS-186/VS-214: drive the fixture from the real raise path.

## Risks / Trade-offs

- [A withdrawn/expired card for the current revision looks lost and is repaired] → Accepted.
  That is the stranded case the scan exists for. An answered card is the one we must not
  revive.
- [A worker already queued from the live loop still runs twice] → Skill skip if a report
  for that revision exists; the repair fix stops further cards. Anyone still looping before
  this lands: **reject** the card (cancels the ticket).
- [Hardening plan/merge "just in case"] → Rejected; see Decision 2.

## Migration Plan

1. Deploy the repair predicate. No schema migration.
2. PR / changelog names the reject-the-card workaround for anyone mid-loop on a live
   workspace.
3. Rollback: revert the commit; the loop returns. No data migration to undo.

## Open Questions

None.
