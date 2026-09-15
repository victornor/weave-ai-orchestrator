## Context

YOLO mode (`policies.yolo`, PLAN §15) lets the daemon grant a project's `plan_approval` and
`merge_approval` decisions instead of the human. The weaver-review capability (VS-223/VS-234/VS-266/
VS-281) records, on each of those cards, whether the weaver has looked: `unseen` (default), `looked`,
or `concerns`. `decisions.answer()` holds an approving answer while a card is open and either marked
`concerns` (VS-266, every actor) or `unseen` (VS-281, every actor *except* the daemon's `system`
actor).

That single exemption is why YOLO can skip the review entirely: `tickets/service.ts` answers YOLO
cards as `{kind: 'system'}` at raise time (the `proposed` transition, the plan repair, the plan
republish, the archive-backfill raise) or, for merges, on the next sweep. The card is always
`unseen` at that instant, and VS-281's comment says so explicitly — "a YOLO plan approval is always
`unseen` at the instant it is answered, so holding the system actor would break YOLO entirely." It
does not break YOLO; it changes what YOLO means. YOLO removes the human's click, not the weaver's
review.

## Goals / Non-Goals

**Goals**

- A YOLO grant of a `plan_approval` or `merge_approval` is held until the weaver marks the card
  `looked at`, exactly as a human's approval is.
- No auto-approve path answers at raise time; the card stays open and unseen for the review wake.
- The grant happens promptly once the review lands, without weakening the CI gate or the merge queue.
- Every auto-approve path is covered and named; the behavior is specified and tested.

**Non-Goals**

- Changing who owns a decision, or how a human overrides a hold.
- Granting `action_approval`, hires, discards, retries or questions under YOLO.
- Changing CI, the merge queue, the landing verification, or `auto_merge` semantics.
- Inferring a review mark from any activity. The mark stays an explicit, asserted write.

## Decisions

### 1. Remove the `system` exemption from the unseen hold

`packages/core/src/decisions/service.ts`:

```ts
const held = approving && (hasConcerns || (unreviewed && actor.kind !== 'system'));
```

becomes

```ts
const held = approving && (hasConcerns || unreviewed);
```

`approving` is true only when the answer key is the approving key of a **review-carrying** kind
(`approvingKeyOf` returns non-null only for `plan_approval`, `merge_approval`, `action_approval`), so
removing the actor check cannot widen the hold to a kind that carries no review. The only
system-actor answers in the codebase come from `tickets/service.ts`'s `autoApprove()`, which only
answers `plan_approval` and `merge_approval` (including the archive-backfill merge). No other
system-actor answer exists, so nothing else changes. `action_approval` keeps its own behavior: it is
human-owned, is never answered by `autoApprove`, and therefore never reaches this path through the
system actor.

### 2. Stop answering at raise time

Remove the four eager grants in `packages/core/src/tickets/service.ts`:

- the `proposed` transition (`if (yolo(next)) { await autoApprove(...) }`, and with it the
  `autoApproved` flag and the re-read it forces),
- the plan repair re-raise in `repairApprovals()`,
- the plan republish in `republishRevisedPlan()`,
- the archive-backfill raise in `raiseArchiveBackfillCard()`.

Each card is then left open and `unseen`. The weaver is already woken at creation (VS-281's
"Creating a review-carrying decision wakes the weaver at once") and, for a republished or repaired
card, by the existing republish/repair notifications. Nothing new is needed to attract the review.

The `autoMergeSweep()` grant stays: it is the merge readiness gateway and it now simply fails its
`autoApprove` call with `revision_pending` while the card is unseen.

### 3. Grant on the `looked` mark

`decisions.review()` becomes `async` and, after the mark is written, calls a new
`tickets.onReviewLooked(decisionId)` when the new status is `looked`. That method:

- loads the decision and its ticket; no-ops unless the decision is still `open` and its status is
  `looked`, and the ticket's project is under YOLO;
- for a `plan_approval`, calls `autoApprove` at once (nothing else gates a plan);
- for an **archive-backfill** `merge_approval` (the card carries an `archive` target), calls
  `autoApprove` at once — this preserves the behavior it had before this change, when it was granted
  at creation, and archive cards have no sweep of their own because their ticket is `done`;
- for an ordinary `merge_approval`, does nothing: the next `autoMergeSweep` grants it, keeping the
  single CI-pending/red gate and the merge-queue flow in one place.

The decision to leave ordinary merges to the sweep is deliberate: the sweep already resolves the PR
state and blocks on pending or failed checks, and putting a second, CI-unaware grant path next to it
is exactly how a skipped-CI landing (VS-471/VS-466) happens. The sweep runs on every supervisor tick
(~15 s) and 50 ms after entering `in_review`, so the delay is bounded and "promptly" is satisfied.

*Alternatives considered.* (a) Subscribe to `decision.updated` on the event bus and grant there: the
bus emits on a microtask, which makes the grant asynchronous to the review write and awkward to
assert deterministically in a core test; making the mark path await the grant is explicit and
testable. (b) Grant ordinary merges on the mark too, after re-checking CI: rejected for the reason
above — one readiness gateway is safer. (c) Keep `review()` synchronous and schedule the grant: the
same testability problem, and it hides the coupling.

Making `review()` async ripples to `packages/core/src/api.ts` (`DecisionsService.review` returns
`Promise<Decision>`), the MCP tool handler (already `async`), and the tests that call it.

### 3a. A YOLO merge grant must match the head that was reviewed

A `looked` mark records the head it was made against (`weaver_reviewed_head_sha`, VS-365). If the
worker pushes after the mark, a grant on the new head would approve work the weaver never read. So a
YOLO grant of a `merge_approval` requires **both** `weaver_review_status = looked` **and** the
recorded head equal to the head the gate is about to land.

**Where the check lives: the answering hold, for the `system` actor only.** `decisions.answer()`
computes `held` for an approving answer; extend it so that when the actor is `system`, the kind is
`merge_approval`, the card is `looked`, and the current approval head differs from the recorded head,
the answer is held (`revision_pending`, with a distinct `details` marker naming the head mismatch). A
null recorded head counts as a mismatch — the daemon must not grant a head it cannot show was
reviewed. This is preferred over checking inside `autoApprove`/the sweep/`onReviewLooked` because
there is one grant door: `autoApprove()` calls `answer()`, and both the sweep and the archive grant go
through it. One invariant covers every present and future YOLO merge path, and it cannot be bypassed
by a new caller. Human approvals keep today's behaviour because the guard is scoped to `system`.

The head the gate will land is resolved through a new `tickets.approvalDeliveryHead(decision)`: the
archive pull request's head when the card carries an `archive` target, otherwise
`deliveryHead(ticketId)`. The same method is what the review tool records as `weaverReviewedHeadSha`,
so the mark and the grant compare like with like — this also fixes the current gap where an archive
card would record the *ticket's* old pull request rather than the archive pull request it exists to
land. Comparison uses a git-sha-equal check (full/short), not raw string equality.

The sweep maps the head-mismatch hold to "auto-merge is waiting: the weaver has not reviewed the
current head yet" through VS-472's once-per-reason recorder, so a card held on head B does not
re-comment on every tick; when the weaver re-marks **looked** at B, the recorded head updates and the
next sweep grants. `onReviewLooked` records the same waiting comment for an archive card that is held
this way, since an archive card has no sweep of its own.

*Alternatives considered.* Putting the check only in `autoMergeSweep` and `onReviewLooked` (the YOLO
grant paths) duplicates it and leaves any future grant caller unprotected; the weaver's stated
preference for the single answer-hold invariant is also the smaller, safer change.

**Plans need no equivalent check.** A revised plan raises a fresh `plan_approval` that starts
`unseen` (the supersession path already covered by "A held approval lifts when it stops being the
live decision"), so a plan grant can only ever be for the revision the weaver marked. There is no
head to match.

### 4. The sweep says why it is waiting

`autoMergeSweep()`'s catch already maps `revision_pending` to a waiting comment through VS-472's
once-per-reason `recordAutoMergeHold`. Read `error.details.weaverReviewStatus` and choose the reason:
`unseen` → "auto-merge is waiting: the weaver has not reviewed it yet"; `concerns` → the existing
"auto-merge is waiting: the weaver has concerns". The once-per-reason recorder means the supervisor's
15-second cadence does not repeat either comment.

### 5. Prompts and docs

The YOLO paragraphs live in the built-in defaults (`packages/core/src/prompts/defaults.ts`) **and** in
the shipped templates (`templates/weaver.AGENTS.md.tmpl`, `templates/brief.md.tmpl`), which override
the defaults (`loadTemplate` prefers the file). Both are updated: YOLO grants the approval *after the
weaver's review*, not on validation/CI alone. `docs/PLAN.md` §15's YOLO paragraph and its review
sentence ("YOLO auto-approve leaves the row `unseen`") are corrected.

### 6. What is explicitly unchanged

- `auto_merge` tickets never raise a `merge_approval`; the sweep still transitions them directly. The
  VS-266 concern-hold behavior is untouched.
- Human answers and the deliberate override are unchanged.
- `action_approval` is never granted by YOLO.
- Turning YOLO off still stops grants that have not happened; a `looked` YOLO card whose project
  turns YOLO off in between is simply not granted (the mode is read at grant time).

## Risks / Trade-offs

- **A stalled weaver now stalls YOLO.** A card can sit unseen if the weaver is paused or out of
  quota. This is the intended meaning of the change — the review is a gate — and the existing
  unreviewed-hold override gives the human a documented way past it. The Needs-you surfaces and the
  creation-time review wake already make the wait visible.
- **`review()` becoming async** touches call sites and tests. It is a narrow, mechanical ripple, and
  it keeps the invariant in one place instead of depending on the MCP tool.
- **Archive-backfill grants on the mark without a CI gate.** This preserves exactly the behavior the
  card had before this change (it was granted at creation, also without a CI gate); adding a CI gate
  to archive landings is a separate question and out of scope.
- **`docs/PLAN.md` §15** must stay the naming/behavior contract: the modified text is the source of
  truth the specs mirror.

## Migration Plan

No data migration. YOLO projects get the new behavior immediately; any card already auto-granted
stands (grants are not reversed). No config or schema change.

## Open Questions

None.
