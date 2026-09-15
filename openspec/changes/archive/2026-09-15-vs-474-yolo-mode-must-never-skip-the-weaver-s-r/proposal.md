## Why

On 2026-09-15 four YOLO merge approvals (VS-468, VS-470, VS-471, VS-472) were auto-granted one to two
seconds after they were raised, every one with `weaver_review_status = unseen`, and VS-471 landed with
every CI check skipped on its merged head before anyone had looked at it. YOLO removes the human's
click on plan and merge approvals; it was never meant to remove the weaver's review. Today the
`system` actor is exempt from the unreviewed hold in `packages/core/src/decisions/service.ts`, so a
YOLO grant is the one approval path that can never be held — and every auto-approve caller answers at
raise time, so there is no moment at which a review could land.

## What Changes

- **A YOLO grant is held until the card is reviewed.** Remove the `system`-actor exemption from the
  unseen hold for `plan_approval` and `merge_approval`: while `weaver_review_status = unseen` (or
  `concerns`) an approving answer is refused, exactly as for a human. Kinds that carry no review are
  untouched.
- **No auto-approve path answers at raise time.** The plan raise at the `proposed` transition, the
  plan repair re-raise, the plan republish at turn end, and the archive-backfill merge all leave the
  card open and unseen instead of granting it. The card is where the weaver's review wake lands.
- **Grant as soon as the review lands.** On a `looked` mark the daemon grants: a plan approval
  immediately; an archive-backfill merge approval immediately; an ordinary merge approval on the next
  `autoMergeSweep`, still subject to the CI-pending/red gate and the merge queue. A `concerns` mark
  keeps holding until a new revision and a `looked` mark.
- **A merge grant also has to match the head that was reviewed.** A `looked` mark records the head it
  was made against (`weaver_reviewed_head_sha`). A YOLO grant of a `merge_approval` requires that
  recorded head to equal the head the gate is about to land; if a worker pushed after the mark, the
  card is treated as unreviewed, is not granted, and the sweep records
  "auto-merge is waiting: the weaver has not reviewed the current head yet" (once per head). The check
  lives in the answering hold for the `system` actor on merge approvals — one invariant covering both
  the sweep and the archive grant — and human approvals keep today's behaviour. A plan revision
  already raises a fresh unseen card, so the same rule holds for plans by construction.
- **The sweep says why it is waiting.** An unseen YOLO merge card records
  "auto-merge is waiting: the weaver has not reviewed it yet" through the existing once-per-reason
  recorder (VS-472), distinct from the existing "the weaver has concerns" reason.
- **The agents are told.** The weaver instructions and the worker brief (built-in defaults and the
  shipped templates) state that YOLO grants approvals *after the weaver's review*.
- **Specs and docs.** `human-decisions/auto-approval`, `human-decisions/conductor-review`,
  `human-decisions/approval-integrity` and `ticket-delivery/openspec-archival` are updated, as is
  `docs/PLAN.md` §15.

Unchanged: `action_approval`, hires, discards and retries keep their owners and are never granted by
YOLO; an `auto_merge` ticket with no decision advances exactly as before; a human's own approval and
its override behave as before; CI, the merge queue and the landing verification are not bypassed.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `human-decisions/auto-approval`: a YOLO grant is held while the card is unseen and granted only
  after the weaver marks it looked; every auto-approve path leaves the card open at raise time.
- `human-decisions/conductor-review`: the unseen hold applies to the `system` actor too, so YOLO waits
  on a review; the system exemption is removed.
- `human-decisions/approval-integrity`: a repaired YOLO plan approval is no longer answered
  immediately; it waits for the weaver's review like an original one.
- `ticket-delivery/openspec-archival`: an archive-backfill merge approval under YOLO is held while
  unseen and lands only after a `looked` mark.

## Impact

- `packages/core/src/decisions/service.ts` — the hold computation and `review()` (grants on a `looked`
  mark).
- `packages/core/src/tickets/service.ts` — remove the four eager `autoApprove` calls; add the
  grant-on-review entry point and the unseen waiting reason in `autoMergeSweep`; `autoApprove` and its
  callers.
- `packages/core/src/api.ts` — the new tickets entry points and `decisions.review` returning a promise.
- `packages/server/src/tools.ts` — the review tool records the head of the pull request the card will
  actually land (the archive PR for an archive card, otherwise the ticket's delivery head).
- `packages/core/src/prompts/defaults.ts` and `templates/weaver.AGENTS.md.tmpl`,
  `templates/brief.md.tmpl` — the YOLO paragraphs.
- `docs/PLAN.md` §15.
- Core tests (`packages/core/src/decisions/decisions.test.ts`,
  `packages/core/src/tickets/*.test.ts`, `packages/core/src/prompts/render.test.ts`) plus a new
  integration test reproducing the 2026-09-15 sequence.
