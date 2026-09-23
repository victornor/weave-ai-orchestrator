## Context

See `proposal.md` — Why. The relevant code:

- `yolo(t)` in `packages/core/src/tickets/service.ts` is `yoloEnabled(project(t.projectId)?.policies ?? null)` — the single reading of the mode used by the merge sweep's filter (`t.autoMerge || yolo(t)`), the mark-time grant (`onReviewLooked`), and the scheduled sweep after `in_review`. A null `t.projectId` therefore reads as "mode off", and the ticket is dropped before the approval is ever examined.
- `autoMergeSweep` filters on `tickets.status = 'in_review'` and resolves the project for its CI policy from `t.projectId` directly. There is no path that starts from the decision.
- The weaver's mark calls `decisions.review` → `tickets.onReviewLooked`. For an ordinary merge that returns early on purpose (the sweep owns the CI gate), so a ticket the sweep cannot see gets no grant and no comment.
- VS-668 already established the meaning we rely on: a ticket assigned to a role belongs to that role's project (`openspec/specs/ticket-lifecycle/project-scoping`). It fixed creation and backfilled existing rows with migration `0062`, but the YOLO readers still resolve the raw `t.projectId`.

## Goals / Non-Goals

**Goals**

- A reviewed YOLO approval resolves whether or not the ticket's own `projectId` is populated, as long as its role names a project.
- A reviewed-but-unanswered YOLO card can no longer sit silently: the daemon recovers it where it can and surfaces it once where it cannot.
- The recovery path is decision-centric, so no ticket-side filter can make a card invisible again.

**Non-Goals**

- Not changing when YOLO may grant: the review requirement, the readiness/CI condition, the reviewed-head guard and the "never at raise time" rule all stand.
- Not adding configuration for the sweep window, or a new tool/route.
- Not fixing or re-running VS-668's backfill; this change is independent of it and works with or without it.

## Decisions

### D1 — Resolve a ticket's project for YOLO through a role fallback

Add a `projectFor(t)` helper: the ticket's own project when `t.projectId` is set, otherwise the project of `t.assigneeRoleId` when that role is project-scoped. Use it for `yolo(t)`, for the merge sweep's policy lookup, and for the archive-backfill head resolution. Rationale: VS-668 made "the role's project" the authoritative project for a role-assigned ticket; the YOLO machinery should read that same project rather than reading a null as "no project". This is the root-cause fix: it makes the normal sweep grant VS-665-class cards promptly, without waiting for the safety threshold.

Alternative rejected: repair only via the safety sweep. It would leave the normal path blind, so a reviewed card would wait out the whole threshold before resolving, and the fix would depend on a periodic pass rather than on the mechanism that is supposed to own the grant.

Alternative rejected: rely on VS-668's backfill alone. The live row is still null until the daemon is upgraded, and the spec's "no project" case is defined by *naming* a project, which the role does — leaving the reader unable to tell "genuinely project-less" from "stale row".

### D2 — A decision-centric safety sweep, not another ticket scan

Add `staleReviewSweep()` on `TicketsService`, called from the supervisor tick beside `autoMergeSweep`. It selects from `decisions` — open, `kind IN ('plan_approval','merge_approval')`, `weaver_review_status IN ('looked','concerns')`, `weaver_reviewed_at` older than `STALE_REVIEWED_APPROVAL_MS` — and, for each, resolves the ticket and its project through `projectFor`. Starting from the decision removes the failure mode entirely: no ticket-side predicate can hide the card.

Grant policy inside the sweep:

- `looked` `plan_approval` → grant via the existing `autoApprove` (recovers a missed mark-path grant).
- `looked` `merge_approval` with an archive target → grant via `autoApprove` (archive cards have no periodic sweep of their own).
- `looked` ordinary `merge_approval` → leave to `autoMergeSweep`; the sweep is the owner of the CI gate.
- `concerns` cards, and any card still open after the above → surface once (D3).

### D3 — The stale surface is once per card

Store `delivery.staleReviewedApproval.decisionId` on the ticket and only comment when it differs; wake the weaver under the idempotency key `stale-reviewed-approval:<decisionId>`. This is the VS-472 lesson: the tick runs roughly every 15 s, so an unconditional surface would flood the thread. A card re-raised with a new decision id may surface again, which is correct — it is a different card.

The surface is a system comment naming the decision id, the review state and the elapsed minutes, plus one weaver wake. Both are needed: the comment is what the human sees on the ticket; the wake is what makes the class fail loud to the agent that can act on it.

### D4 — The sweep scans `looked` and `concerns`; it grants only `looked`

The requirement names both review states as "reviewed but unanswered". Both are scanned and both are surfaced if stale; only `looked` is ever granted, preserving the invariant that a concern holds until a fresh revision. Trade-off: a `concerns` merge card already gets one "auto-merge is waiting: the weaver has concerns" comment from the merge sweep, so a long-standing concerns card may gain a second, differently-worded comment. Accepted: it is once per card, and it is exactly the "nobody revisited this" signal the requirement asks for.

### D5 — Threshold and wiring

`STALE_REVIEWED_APPROVAL_MS = 10 * 60 * 1000` as a module constant in `tickets/service.ts`; the mark-time and merge-sweep paths resolve in seconds, so anything still open after ten minutes is genuinely stuck. The supervisor calls the new sweep through a `typeof … === 'function'` guard, exactly as it calls `autoMergeSweep`, so existing supervisor tests that stub `tickets` with only `autoMergeSweep`/`livenessViolations` keep working.

## Risks / Trade-offs

- [A `looked` held card (head moved, CI pending) is surfaced every ten minutes] → The surface is once per card, not per tick; the card's own hold comment already explains the concrete reason, and the sweep adds one diagnostic. The head-move path already wakes the weaver separately (VS-474), so the surface may be redundant there — acceptable for a once-per-card safety net.
- [A concerns card the worker is actively fixing is surfaced at ten minutes] → Once per card; a single nudge. D4 records why this is preferred to excluding `concerns`.
- [The role fallback grants YOLO for a ticket whose row project is null but whose project actually has the mode off] → It reads the role's project, which is the project the worker was spawned into and the project every other reader now uses; there is no other project it could be. If the role's project has the mode off, the fallback grants nothing.
- [A role is retired between the ticket's creation and the sweep] → `projectFor` still resolves the role row's project; a role row is not deleted when retired. If the role is genuinely gone, the fallback returns null and the ticket behaves as it does today.

## Migration Plan

1. Land the code change. No schema migration is needed; `0062` from VS-668 already backfills stale rows and runs on upgrade.
2. On `weave daemon upgrade`, `0062` fills VS-665's `project_id`; independently, the role fallback means its card is grantable even before that. Either way VS-665 self-corrects without a manual nudge — the PR will state this and note it was not verified against the live daemon (worker rules forbid driving it).
3. Rollback: the change is additive. Removing it returns the daemon to reading only the raw `project_id`; the `0062` backfill is unaffected.

## Open Questions

None that change the specs, approach or task breakdown. Whether the sweep should also cover a `question` or `gate_finding` a weaver left unanswered is out of scope — those carry no review state and are not YOLO kinds.
