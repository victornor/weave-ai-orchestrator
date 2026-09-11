## Context

See `proposal.md` — Why. This section covers only what the ticket asked us to establish before designing: which of the two candidate "revision landed" mechanisms actually fires, and for which decision kinds.

### What actually happens today, read from the code (not assumed)

`packages/core/src/decisions/service.ts` and `packages/core/src/tickets/service.ts`:

- **`target.documentId`/`revision`** (`packages/shared/src/decision-target.ts`) is written only by `raisePlanApproval`-equivalent code at `tickets/service.ts:570` (`plan_approval`, pointing at the `plan` document) and `raiseActionApproval` at `tickets/service.ts:330` (`action_approval`, pointing at the `action` document). **`merge_approval` (`tickets/service.ts:584-596`) never sets `target` at all.** A mechanism keyed on comparing `target.revision` to the document's current revision would work for two of the three carrying kinds and silently not exist for the third — the one the ticket's own motivating incident (VS-259) doesn't even distinguish from the other two.
- **`correlationKey` supersession** (`supersedeOpen`, `service.ts:88`, invoked from `create()` at `service.ts:170` before every insert) is universal: every carrying kind is created with a fixed correlation key (`plan_approval:${ticketId}`, `merge_approval:${ticketId}`, `action_approval:${ticketId}`). Any *new* decision of that kind for that ticket first supersedes whatever is still `open` under the same key.
- Tracing an actual revision cycle for `plan_approval`: a `revise` answer marks the current decision `answered` (not `open`) and transitions the ticket to `proposing` (`applyPlanApproval`, `service.ts:198-200`) — the old decision is no longer live by the time the worker touches anything. When the worker re-proposes, `tickets/service.ts:555-573` creates a **new** `plan_approval` decision at the `to === 'proposed'` transition, unconditionally superseding any decision still `open` under `plan_approval:${ticketId}`, and the new one starts `conductorReviewStatus: unseen` (there is no code path that carries a review mark forward — confirmed by the existing spec's "A repaired approval starts unseen" scenario, which already covers the analogous stranded-approval case). The same shape holds for `merge_approval`: `applyMergeApproval`'s non-approve branch (`service.ts:230-234`) moves an `in_review` ticket back to `in_progress` once "changes requested" is answered, and the next `to === 'in_review'` transition (`service.ts:582-597`) raises a fresh `merge_approval`, again unconditionally superseding anything still open under that ticket's key.
- The scenario the ticket describes — a card still `open`, marked `concerns`, with Approve/Revise both live — is exactly the state *before* a `revise`/`changes` answer exists: the human has not yet acted, and no worker activity has happened yet either, because nothing in this system lets a worker touch the ticket while it still holds an open plan/merge approval (see `AGENTS.md`'s status table: `in_review`/`proposed` is "nothing, normally — waiting on the human"). So "the revision lands" is never a background event that mutates the currently-open card in place; it only ever happens by that exact card leaving the `open` state — either answered directly, or (this proposal's new case) implicitly superseded by a fresh card raised through the normal transition-driven `create()` call. There is no third path to check for.

**Conclusion:** build the hold and its lift entirely on `status` + `conductorReviewStatus`, both already columns on the row being answered. No use of `target.documentId`/`revision` for this purpose, no schema change, and the same logic covers all three review-carrying kinds uniformly. `documentTarget()` stays exactly what it is today — a way to point a card at the document it's judging — unrelated to this gate.

## Goals / Non-Goals

**Goals:**
- A decision marked **looked at, with concerns**, while still `open`, cannot be answered with its approving key, from any caller.
- The moment that same decision stops being the live question (answered, superseded, or otherwise no longer `open`), the block is moot — there is nothing left to approve on it, and whatever replaced it (if anything) starts unheld.
- A human always has a way past a stuck hold, and that way is auditable.

**Non-Goals:**
- No change to who owns `plan_approval`/`merge_approval`/`action_approval` (still always `human`) or to the conductor's rule that it never answers them.
- No change to `ac_decision_review`'s note requirement or 500-character cap.
- No attempt to hold a decision that is not one of the three `CONDUCTOR_REVIEW_KINDS`.
- No retroactive hold on a decision already `answered` before this change ships.

## Decisions

### 1. `concerns` blocks, full stop — no fourth status, no blocking flag

The ticket lists three shapes for "does concerns alone block": (a) concerns always blocks, (b) a second field distinguishing "blocking" from "advisory" concerns, (c) inferring blocking from a side channel (rejected in the ticket text itself).

Choosing **(a)**. Captain asked for exactly this, twice, in plain terms ("we shouldn't allow approval of a card that has been asked for improvements by the conductor," "I should not be able to approve it") — there is no daylight between what was asked and what (a) does. (b) is real complexity for a case that has not actually happened yet: nothing today distinguishes a blocking concern from an advisory one because until this change nothing acted on the distinction, so there is no existing usage pattern to preserve, only a hypothetical one to design for pre-emptively. The proposal's own "cost" of (a) — losing a way to raise a non-blocking caveat through `ac_decision_review` — is absorbed without new schema: a caveat that should not stop the human belongs in a ticket comment or a chat message (both already unblocked, both already how the conductor talks to the human today), not in the review mark. `conductor-review`'s own spec purpose line already says the state "records that the conductor looked" and must not become more than that on the *review* side; this change adds a consequence on the *answer* side without touching what the mark itself means. If, after this ships, the conductor starts writing hedged concerns just to avoid holding the human up, that is observable (the concern text will say so) and is the trigger for revisiting with (b) — not a reason to build it now.

### 2. The hold is computed at answer time from `status === 'open'` and `conductorReviewStatus === 'concerns'` — no new column, no denormalized "held" flag

Both fields already exist and are already read together nowhere else, but both are already loaded by `get()`/`find()` inside `answer()`. Computing the hold inline keeps the source of truth singular: `ac_decision_review` still owns `conductorReviewStatus`, `create()`/`supersedeOpen()` still own `status`, and the gate is a pure read of both, not a third thing to keep in sync. A denormalized flag would need its own invalidation on every place `status` or `conductorReviewStatus` changes — more surface for exactly the kind of drift this ticket exists to close.

### 3. The override is a distinct request shape, not a second click on the same option key

`NAMED_CARD_OPTION_KEYS` is a closed contract (VS-111): a decision's card must offer exactly its kind's named keys, so a card can never be sent a key its decision does not accept. Adding an `approve_override` option key would violate that contract for every other reader of `NAMED_CARD_OPTION_KEYS` and would still be "a click," which the ticket explicitly rules out.

Instead, `answer()`'s input grows two optional fields, meaningful only when the hold would otherwise fire:

```ts
{ key?, text?, remember?, inputs?, overrideHold?: boolean, overrideReason?: string }
```

`overrideHold: true` plus a non-empty `overrideReason` (same shape as a concern summary — non-whitespace, capped like other free text on this surface) is required to answer `approve` while held; omitting either still refuses, with the same distinguishable error. This is answered through the *same* `POST /:id/answer` route and the *same* `ac_decision_answer`-shaped CLI path everyone already uses — no second endpoint — but the UI presents it as a separate, deliberate control (a distinct "Override & approve" affordance that opens a reason field), never a hidden option toggle. This mirrors the precedent already in `packages/cli/src/commands/decision.ts` (`card.confirm`, a typed confirmation gated on `tone === 'danger'` for destructive answers) without reusing that exact mechanism, since typed confirmation re-submits the *same* key and this needs a reason to persist alongside the answer.

The override is recorded via `recordActivity(..., 'decision.hold_overridden', ...)` (consistent with every other decision side effect's audit trail) carrying the reason, and the reason is also appended to the ticket as a system comment (mirroring how `applyPlanApproval`/`applyMergeApproval` already surface answer `text` on the ticket) so it is visible in-place, not only in the activity log.

### 4. New error code: `revision_pending`

Distinct from `wrong_status` (which reports the decision's lifecycle status, e.g. answered/superseded/withdrawn) because a held decision is still `open` — a caller retrying with a different key, or a human reading the error, needs to know this is a content-based hold, not a stale-state error. Maps to HTTP 409 (alongside `wrong_status`, `conflict`, `duplicate_entry`): the request is valid against an open decision, but conflicts with its current review state. Details carry `{ conductorReviewNote, conductorReviewedAt }` so a caller can show *what* is being waited on without a second fetch (acceptance criterion 2).

### 5. Card copy: extend `conductorReviewCopy`'s return shape with a `held: boolean`, not a new tone

`ConductorReviewCopy.tone` already drives the line's color/weight; the *held* fact is a separate axis (only meaningful for `concerns` + `open`, never for `looked`/`unseen`/`after`) rather than a fourth tone. `held` is computed the same way the service computes it — `tone === 'concerns' && d.status === 'open'` — so card and server never disagree about when the hold is live. The line itself gains no new wording requirement from this change (the existing "Conductor reviewed — has concerns" line stands); a new short sentence ("Approval is held until this is revised, or you override it.") renders only when `held` is true, satisfying captain's ask that the card "say we're waiting for a revision."

### 6. The hold applies to the system actor too — YOLO's automatic merge answer is not exempt

`autoMergeSweep()` (`tickets/service.ts:1097-1129`) answers an already-open `merge_approval` as the system actor (`autoApprove`, `service.ts:274-279`) once CI is green — but only for a YOLO ticket. A ticket carrying `autoMerge: true` never has a `merge_approval` raised in the first place: the `to === 'in_review'` create call is guarded by `!next.autoMerge` (`tickets/service.ts:582`), so for that ticket `openApproval(...)` inside the sweep always returns null and it goes straight to `merging` in the `else` branch (`service.ts:1122-1124`) — there is no decision, so there is nothing for the conductor to mark and nothing for this hold to apply to. A YOLO ticket is the case that matters here: `yolo(next)` is true while `autoMerge` is false, the guard passes, a real `merge_approval` is raised and stays `open` for the lifetime of the CI run — exactly the window in which the conductor can mark it `concerns`. Exempting the system actor from the hold would leave that one case — an unattended approval going through on a flagged change — open specifically where this ticket most needs it closed.

The hold therefore does not check `actor.kind`. `autoMergeSweep`'s existing per-ticket `try/catch` (`service.ts:1105-1126`) already logs and continues past a thrown `answer()` and does not otherwise remove the ticket from `in_review`; the merge card stays `open` and visibly held (Decision 5's copy) where its owner — always `human` for `merge_approval` — can already see and override it. No sweep code changes: the new error is just another reason `answer()` can throw, which the loop already tolerates per-ticket.

This does narrow the existing "YOLO does not wait on a review" requirement, for YOLO only: YOLO's `plan_approval` auto-answer is unaffected (a review still cannot exist yet at that instant), but a YOLO ticket's `merge_approval` can now sit unmerged behind a concern until overridden, same as a human-owned one. That is the intended behavior, not a regression — YOLO was never meant to bypass a *stated* objection, only the need to click.

**Known limitation, out of scope to close:** a plain `auto_merge` ticket bypasses this hold entirely, because it bypasses the merge approval entirely — there is no decision for the conductor to mark in the first place, so a change delivered under `auto_merge` can merge with an outstanding conductor concern with nothing in this system able to stop it. This is pre-existing behavior this change does not alter; it is named here so a reader does not infer coverage this design does not have. Raising a `merge_approval` for `auto_merge` tickets purely so it could be held would defeat the purpose of the flag, and it is not what this ticket asked for — not fixed here.

## Risks / Trade-offs

- **[Risk]** A held decision with no live worker (retired, failed, cancelled-and-reassigned) leaves the human unable to approve through the normal path. → **Mitigation**: the override (Decision 3) is unconditional — it does not check worker liveness — so it is always the way out, satisfying acceptance criterion 5 without needing to detect worker death as a separate condition.
- **[Risk]** A conductor that wants to flag something without stopping the human now has no formal "advisory-only concern" — see Decision 1. → **Mitigation**: accepted trade-off, revisit only if it manifests as observed under-marking or over-hedged concern text.
- **[Risk]** Extending the answer input shape on a widely-used route is easy to under-validate (e.g. accepting `overrideHold` on a decision that isn't held, or on a non-approving key, silently). → **Mitigation**: `overrideHold`/`overrideReason` are only ever consulted when the hold would otherwise fire; on any other answer they are accepted but ignored (never stored, never recorded), so there is no way to pre-emptively "bank" an override for later.
- **[Risk]** Tests that already answer `plan_approval`/`merge_approval`/`action_approval` fixtures with `approve` after fabricating a `concerns` mark (if any exist) start failing. → **Mitigation**: grep the suite for `conductorReviewStatus`/`review(` fixtures combined with an `approve` answer before implementing; update them to either not mark concerns or to pass the override, per what each test is actually asserting.
- **[Risk]** A YOLO ticket held behind a concern (Decision 6) only surfaces as a `log.warn` inside `autoMergeSweep`'s catch — nothing tells the human on the ticket itself that auto-merge is stalled for this reason, unlike the existing "CI is red" comment for the CI-pending case. → **Mitigation**: post the same kind of system comment (`"auto-merge is waiting: the conductor has concerns"`) when `autoApprove` fails specifically with `revision_pending`, mirroring `service.ts:1116`; tracked as its own task.
- **[Risk]** A plain `auto_merge` ticket never raises a `merge_approval` at all (Decision 6), so it can merge over an outstanding conductor concern with no hold able to apply — see the known limitation named in Decision 6. → **Mitigation**: none in this change; named explicitly rather than left for a reader to wrongly assume is covered.

## Migration Plan

No data migration: both fields already exist on every `decisions` row. Ships as a single change: service-level gate + override, shared error code, copy, then UI. No feature flag — the acceptance criteria are the rollout (server-side gate first is safe to land alone, since the UI simply gains a new failure mode to render; the override must land in the same change so the gate is never deployed without an escape hatch).
