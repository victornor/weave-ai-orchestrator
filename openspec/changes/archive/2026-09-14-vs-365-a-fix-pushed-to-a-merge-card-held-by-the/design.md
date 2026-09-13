## Context

See `proposal.md` — Why. Three existing pieces shape the approach:

- A **concerns** mark holds approval until a fresh review mark or a superseding decision: `answer()` refuses an approving answer purely on `weaverReviewStatus === 'concerns'` (`packages/core/src/decisions/service.ts`).
- The only wake that reaches a held review being addressed today is VS-275's "a worker answered the held review", which fires on an agent **comment** (`packages/core/src/tickets/service.ts`, `comment()`).
- VS-361 already gives review-carrying decisions a weaver wake at creation, keyed `decision-review:<id>` (`packages/core/src/decisions/service.ts`). The wake service already supports idempotency keys (`packages/core/src/wake/index.ts`, Gate 0).

The review mark itself (`decisions.review()`) is synchronous and is reached from one place: the `weave_decision_review` MCP tool (`packages/server/src/tools.ts`). The delivery record on a ticket (`delivery.prUrl` / `delivery.branch`) and the `worktrees` row tell the daemon what the ticket's branch is. VS-364 (in review, not on `main` as of this change) adds a turn-end hook in `packages/core/src/runs/engine.ts` (`republishPlanAfterTurn`) for plan revisions.

## Goals / Non-Goals

**Goals:**

- A commit pushed to a held (`concerns`) merge card wakes the weaver exactly once per new head, without a worker comment.
- "Moved since the review" is exact: the head reviewed is recorded at review time.
- One general resolver, correct for `pr` and `local-branch` delivery and for any forge.
- Both a turn-end check (catch a push at once) and the existing PR reconcile (catch out-of-band pushes) use the same comparison.

**Non-Goals:**

- No change to who owns merge approval, how an override works, or what lifts a hold.
- No `plan_approval` or `action_approval` behaviour (plans are VS-364's).
- No new wake source, no new route, no change to the review UI's rendering.

## Decisions

### 1. Record the reviewed head on the decision, at review time

Add `decisions.weaver_reviewed_head_sha` (migration `0036`). `review()` writes it from a new optional `reviewedHead` input, so the mark stays synchronous and pure. The MCP tool resolves the head (async) before calling `review()`.

*Alternatives considered.* **Baseline the head lazily on first observation after the mark** — rejected: if the worker pushes before the daemon's first observation, the pushed head becomes the baseline and the wake never fires, which is the incident's exact race. **Store the head in `tickets.delivery_json`** — rejected: the head is per review, not per ticket, and the idempotency key is naturally per decision.

### 2. One general delivery-head resolver

`TicketsService.deliveryHead(ticketId)` resolves, in order, the **PR head** (when the ticket has a PR work product and the registered forge reports one), else the **worker worktree's branch head** (`git rev-parse HEAD` in the worktree), else the **project clone's branch ref**. It never throws and returns `null` when nothing resolves.

Preferring the PR head keeps review-time and observation consistent: the thing a fix moves for a PR is the PR's head. The worktree branch head covers local-branch delivery and a worker that has not pushed; the clone ref is the last resort after a worktree is gone.

*Alternatives considered.* **Forge-only** — rejected: `local-branch` has no PR and the ticket explicitly requires both. **Worktree-only** — rejected: a removed worktree leaves no head after retirement, and the PR head is the authoritative one the weaver actually reviewed.

### 3. Idempotency via the existing key, one comparison method

The wake uses `source: 'system'` and `idempotencyKey: 'held-review:<decisionId>:<sha>'`, exactly as VS-361's `decision-review:<id>` does. Gate 0 in the wake service already collapses a repeat to the existing live row, so the same head wakes once and a second new head (a different key) wakes again. `TicketsService.noteHeldReviewHead(actor, ticketId, head?)` is the single comparison: it finds the newest open `merge_approval` with `weaver_review_status = 'concerns'`, returns without resolving anything when there is none, baselines a decision whose recorded head is null, and otherwise wakes on a difference. `head` defaults to `deliveryHead(ticketId)`; tests pass it explicitly.

*Alternatives considered.* **A new wake source** — rejected as needless surface; VS-361 shows `system` + a key is the established shape. **Comparing in the reconcile and the engine separately** — rejected: two comparisons would drift.

### 4. Hooks: turn end and the PR reconcile

The end of a worker's turn calls `noteHeldReviewHead` (`packages/core/src/runs/engine.ts`), beside VS-364's `republishPlanAfterTurn` at its three finalize sites, so a push made during the turn is caught at once. The supervisor's `reconcilePullRequests` pass calls the same method for each `in_review` ticket with a PR, so an out-of-band push is caught too. The check is gated on a held concerns `merge_approval` existing, so no forge or git work happens on the overwhelming majority of turns.

If VS-364 has landed by apply time, its `republishPlanAfterTurn` is extended rather than a second hook added beside it; if not, a sibling hook is added and folded in on rebase.

### 5. The worker also comments

`skills/weave-ai-worker/SKILL.md` gains one line: after pushing a fix to a held merge concern, leave a short ticket comment naming the fix commit. The VS-275 comment wake is the belt to this change's braces, and it costs nothing when the head-based wake already fired (the idempotency keys differ, but the second wake is a benign notification).

## Risks / Trade-offs

- **VS-364 lands first and both edit the same three finalize sites** → a small textual conflict. Mitigation: at apply, rebase and fold this check into VS-364's hook if it is present; the ticket names this explicitly.
- **A local worktree HEAD that differs from the pushed PR head** (extra unpushed commit) could make the baseline and observation disagree → mitigated by preferring the PR head whenever a PR exists, so both sides read the same source.
- **A forge call at every worker turn** when a held card exists → acceptable because it is gated on the held card and a held card is rare; the resolver never throws, so a forge outage degrades to no wake rather than a failed turn.
- **Old rows have a null recorded head** → the first observation after upgrade baselines silently; the worst case is one missed wake for a card already held at upgrade time, which the worker-comment path still covers.

## Migration Plan

An additive `ALTER TABLE decisions ADD COLUMN weaver_reviewed_head_sha TEXT` (no rebuild — the table's CHECKs are untouched, the same recipe as `0025`). Pre-migration rows read `null`. Rollback is safe: older code ignores the column.

## Open Questions

None.
