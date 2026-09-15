## MODIFIED Requirements

### Requirement: Review is never a gate on answering

A human SHALL be able to answer a `plan_approval`, `merge_approval`, or `action_approval` at any moment regardless of its conductor review state, with two exceptions, each scoped to a decision that is still `open`: an approving answer is refused unless answered with a deliberate override (see "A human can override a held approval").

1. An **approving** answer (the option that would move the ticket forward — `approve` on `plan_approval` and `action_approval`, `approve` on `merge_approval`) on a decision whose review state is currently **not looked at yet** SHALL be refused, unless answered with the deliberate override. This exception applies to every actor that can answer a decision, **including the `system` actor**: the daemon's own YOLO auto-approval is refused until the weaver has marked the card looked at, so YOLO waits on the review rather than bypassing it.
2. An **approving** answer on a decision whose review state is currently **looked at, with concerns** SHALL be refused, unless answered with the deliberate override. This exception applies to every actor that can answer a decision, including the `system` actor (unchanged from the concern-hold this change extends).

For the `system` actor's grant of a `merge_approval`, the first exception SHALL additionally cover a card marked **looked at** whose recorded review head does not match the head about to be landed: that card is treated as unreviewed (see `human-decisions/auto-approval`). A human's approving answer SHALL NOT be subject to that head comparison.

Outside those two cases, the answer path SHALL NOT wait for a review, SHALL NOT refuse an answer because the state is **looked at**, SHALL NOT queue the answer on a review, and SHALL NOT add latency that is a function of the review state. A non-approving answer (`revise`, `reject` on `plan_approval`/`action_approval`; the non-approving option on `merge_approval`) SHALL NEVER be refused on account of the review state, regardless of what that state is.

The refusal SHALL be a distinct, identifiable outcome — never the same error a caller gets for answering a decision that is not `open`, and never silent. It SHALL name what is being waited on: the pending review when the state is **not looked at yet**, and the concern when the state is **looked at, with concerns**.

The concerns refusal applies equally to every actor that can answer a decision, including the system actor that answers a `merge_approval` on a YOLO ticket once its checks pass: that automatic answer SHALL be refused exactly as a human's would be, and the ticket SHALL remain `in_review` with the `merge_approval` still `open` and still visible to its human owner. (A ticket delivered under `auto_merge` never raises a `merge_approval` in the first place, YOLO or not, and so has no decision for this requirement to hold — that is unrelated pre-existing behavior, not a case this requirement covers.)

While a conductor review is in progress — the conductor has been woken about the decision but has not yet marked it — the decision SHALL still read as **not looked at yet** and SHALL be held accordingly.

#### Scenario: Approving an unseen plan succeeds immediately

- **WHEN** a human answers `approve` on an open `plan_approval` whose review state is **not looked at yet**, supplying the deliberate override and a stated reason
- **THEN** the answer is recorded at once and the ticket proceeds exactly as it would have before this requirement existed, because the override was supplied

#### Scenario: Approving a plan the conductor looked at without concerns succeeds immediately

- **WHEN** a human answers `approve` on an open `plan_approval` whose review state is **looked at** (no concerns)
- **THEN** the answer is recorded at once and the ticket proceeds exactly as it would have before this requirement existed

#### Scenario: Approving a plan the conductor has concerns about is refused

- **WHEN** a human answers `approve` on an open `plan_approval` whose review state is **looked at, with concerns**, without an override
- **THEN** the answer is refused with a distinct, identifiable error naming the concern, the decision remains `open` and unanswered, and the ticket does not proceed

#### Scenario: Approving a merge the conductor has concerns about succeeds immediately

- **WHEN** a human answers `approve` on an open `merge_approval` whose review state is **looked at, with concerns**, supplying a deliberate override and a stated reason
- **THEN** the answer succeeds immediately, exactly as it would have before this requirement existed, because the override was supplied

#### Scenario: Approving a merge the conductor has concerns about is refused without an override

- **WHEN** a human answers `approve` on an open `merge_approval` whose review state is **looked at, with concerns**, without an override
- **THEN** the answer is refused with a distinct, identifiable error naming the concern, and the decision remains `open`

#### Scenario: Revising a plan the conductor has concerns about still succeeds

- **WHEN** a human answers `revise` on an open `plan_approval` whose review state is **looked at, with concerns**
- **THEN** the answer is recorded and the ticket returns to `proposing` exactly as a revise answer on any other review state would

#### Scenario: Rejecting a plan the conductor has concerns about still succeeds

- **WHEN** a human answers `reject` on an open `plan_approval` whose review state is **looked at, with concerns**
- **THEN** the answer is recorded and the ticket is cancelled exactly as a reject on any other review state would

#### Scenario: Requesting changes on a held merge approval still succeeds

- **WHEN** a human answers the non-approving option on an open `merge_approval` whose review state is **looked at, with concerns**
- **THEN** the answer is recorded and the ticket returns to `in_progress` exactly as it would for any other review state

#### Scenario: YOLO does not wait on a review

- **WHEN** a project is in YOLO mode, a `plan_approval` or `merge_approval` has already been marked **looked at**, and its readiness condition is met
- **THEN** the daemon answers it as the system actor without waiting on the human — the review has landed, and nothing about the review state delays it further

#### Scenario: YOLO waits on an unreviewed card

- **WHEN** a project is in YOLO mode and a `plan_approval` or `merge_approval` is created
- **THEN** the daemon's own grant is refused while the card is **not looked at yet**, exactly as a human's would be, and the daemon grants it only once the weaver marks it looked at

#### Scenario: An unattended merge held by a concern is not silently approved

- **WHEN** a YOLO ticket's `merge_approval` is open, its review state is **looked at, with concerns**, and its checks pass
- **THEN** the automatic approval is refused exactly as a human's would be, the ticket stays `in_review`, and the `merge_approval` remains `open` for its human owner to act on

#### Scenario: Captain answers while the conductor is still reading

- **WHEN** the conductor has been woken about an open `merge_approval` but has not yet marked it, and the human answers its approving option
- **THEN** the answer is refused (the review state at that moment is still **not looked at yet**) unless the human supplies the deliberate override, and the conductor may still mark it afterwards as after-the-fact

#### Scenario: Approving an unseen plan without an override is refused

- **WHEN** a human answers `approve` on an open `plan_approval` whose review state is **not looked at yet**, without an override
- **THEN** the answer is refused with a distinct, identifiable error naming the pending review, the decision remains `open` and unanswered, and the ticket does not proceed

#### Scenario: Approving an unseen merge approval without an override is refused

- **WHEN** a human answers `approve` on an open `merge_approval` whose review state is **not looked at yet**, without an override
- **THEN** the answer is refused with a distinct, identifiable error naming the pending review, and the decision remains `open`

#### Scenario: Approving an unseen action approval without an override is refused

- **WHEN** a human answers `approve` on an open `action_approval` whose review state is **not looked at yet**, without an override
- **THEN** the answer is refused with a distinct, identifiable error naming the pending review, and the decision remains `open`

#### Scenario: A non-approving answer on an unseen decision still succeeds

- **WHEN** a human answers `revise` or `reject` on an open `plan_approval`/`action_approval`, or the non-approving option on an open `merge_approval`, whose review state is **not looked at yet**
- **THEN** the answer is recorded exactly as it would be on any other review state

### Requirement: A held merge approval whose head moves wakes the weaver

When the weaver marks an open `merge_approval` **looked at, with concerns**, the daemon SHALL record on that decision the head the review was made against. It SHALL record the same on a **looked at** mark, because a YOLO grant of that card is held until the head it lands equals the head reviewed. The head SHALL be resolved generally: the pull request's head when the ticket has a pull request and its forge reports one, otherwise the ticket branch's head from its worker worktree, otherwise the project clone's branch ref; for an archive-backfill card it SHALL be the archive pull request's head. A mark SHALL still succeed when no head can be resolved; the decision then simply carries no recorded head.

While that decision stays `open` and marked **looked at** or **looked at, with concerns**, the daemon SHALL compare the head the card will land against the recorded head both at the end of a worker's turn and on its periodic pull-request reconcile. When the current head differs from the recorded head, it SHALL enqueue exactly one wake for the workspace's weaver, naming the ticket, the pull request, and the recorded and the new head, and carrying the decision's id and both heads in its payload. A **concerns** wake states the review moved since the concerns; a **looked at** wake asks the weaver to re-review, so a YOLO card whose grant is held on a moved head is never left to stall silently.

The wake SHALL be idempotent per (decision, head): the same new head observed again SHALL NOT enqueue a second wake, whether from the turn-end check or the reconcile, and a further new head SHALL enqueue one more. The wake is a notification only: it SHALL NOT set, clear, or otherwise change any review state, and it SHALL NOT itself lift the hold.

A decision that is **not looked at yet**, or that is no longer `open` (answered, superseded, withdrawn, expired), SHALL NOT produce this wake. A **looked at** card that recorded no head SHALL NOT be baselined — recording the current head as reviewed would authorise a head the weaver never read, so it is left as it is. A `plan_approval` or `action_approval` SHALL NOT produce it however it is marked or however its ticket moves.

#### Scenario: A pushed fix wakes the weaver once

- **WHEN** an open `merge_approval` is marked **looked at, with concerns** while the delivery head is `sha1`, and a worker later pushes `sha2`
- **THEN** exactly one wake is enqueued for the weaver, naming the ticket and `sha2`, and the decision remains `open` and marked **looked at, with concerns**

#### Scenario: The same head does not wake again

- **WHEN** the daemon observes the same delivery head `sha2` again at the end of a later turn or on a later reconcile
- **THEN** no further wake is enqueued for the weaver

#### Scenario: A second new commit wakes again

- **WHEN** a held merge approval has already woken for `sha2` and the delivery head later moves to `sha3`
- **THEN** one more wake is enqueued for the weaver, naming `sha3`

#### Scenario: A looked mark produces no wake

- **WHEN** an open `merge_approval` is marked **looked at** and the head the card will land has not moved since
- **THEN** no wake is enqueued for the weaver

#### Scenario: A looked mark's moved head wakes the weaver to re-review

- **WHEN** an open `merge_approval` is marked **looked at** at `sha1` and the head the card will land later moves to `sha2`
- **THEN** exactly one wake is enqueued for the weaver, naming the pull request and the recorded head `sha1` and the new head `sha2` for re-review, and the decision remains `open` and marked **looked at**

#### Scenario: An unreviewed merge approval produces no wake

- **WHEN** an open `merge_approval` whose review state is **not looked at yet** has its delivery head moved
- **THEN** no wake is enqueued for the weaver

#### Scenario: A plan approval produces no wake

- **WHEN** an open `plan_approval` is marked **looked at, with concerns** and its ticket's delivery head moves
- **THEN** no wake is enqueued for the weaver by this requirement

#### Scenario: The head recorded at the review does not wake

- **WHEN** a merge approval is marked **looked at, with concerns** at head `sha1` and the daemon next observes `sha1`
- **THEN** the delivered head is unchanged and no wake is enqueued

#### Scenario: A mark with no resolvable head still lands

- **WHEN** a merge approval is marked **looked at, with concerns** while no delivery head can be resolved
- **THEN** the mark succeeds, and the first head observed afterwards is recorded as the baseline without waking the weaver

#### Scenario: A looked mark with no resolvable head is not baselined

- **WHEN** a merge approval is marked **looked at** while no head can be resolved, and a head is observed afterwards
- **THEN** the mark succeeds, the recorded head stays absent, and no wake is enqueued

#### Scenario: A local-branch delivery wakes on the branch head

- **WHEN** a ticket delivers on a local branch with no pull request, is held under **looked at, with concerns**, and its branch head moves
- **THEN** one wake is enqueued for the weaver, naming the ticket and the new commit
