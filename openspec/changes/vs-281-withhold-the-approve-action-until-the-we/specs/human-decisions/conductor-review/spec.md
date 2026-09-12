## MODIFIED Requirements

### Requirement: Review is never a gate on answering

A human SHALL be able to answer a `plan_approval`, `merge_approval`, or `action_approval` at any moment regardless of its conductor review state, with two exceptions, each scoped to a decision that is still `open`: an approving answer is refused unless answered with a deliberate override (see "A human can override a held approval").

1. An **approving** answer (the option that would move the ticket forward — `approve` on `plan_approval` and `action_approval`, `approve` on `merge_approval`) on a decision whose review state is currently **not looked at yet** SHALL be refused, unless answered with the deliberate override. This exception applies to every actor **except** the `system` actor: the daemon's own YOLO auto-approval is not a human being asked to approve an unreviewed card, and holding it would make YOLO unable to grant the approvals it exists to grant.
2. An **approving** answer on a decision whose review state is currently **looked at, with concerns** SHALL be refused, unless answered with the deliberate override. This exception applies to every actor that can answer a decision, including the `system` actor (unchanged from the concern-hold this change extends).

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

- **WHEN** a project is in YOLO mode and a `plan_approval` is created
- **THEN** the daemon answers it as the system actor without a review mark, exactly as before, because the **not looked at yet** hold does not apply to the system actor — YOLO's own grant is not a human being asked to approve an unreviewed card

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

### Requirement: A human can override a held approval

A human SHALL have a way to answer an approving option on a decision held under either exception in "Review is never a gate on answering" — a **not looked at yet** card or one marked **looked at, with concerns** — without waiting for a review or a revision. That path SHALL require a deliberate action distinct from the normal approving answer — at minimum, a stated reason for overriding the hold — and SHALL NOT be satisfiable by resubmitting the same answer that was refused.

An override SHALL be recorded: who invoked it, when, on which decision, which hold it overrode, and the reason given. The record SHALL be visible on the ticket the decision belongs to, not only in an internal log.

An override SHALL only ever be considered on a decision that is actually held. Supplying an override on a decision that is not held — including a **looked at** decision — or on a non-approving answer SHALL have no effect: it is neither stored nor recorded, and the answer proceeds exactly as it would without it.

An override SHALL be available regardless of whether the ticket's worker is still active, paused, failed, or retired, and regardless of the weaver's state — paused, failed, out of quota, or never having run: the human's path past the hold SHALL NOT depend on the worker's or the weaver's state.

#### Scenario: A human overrides a held plan approval

- **WHEN** a human answers `approve` on a `plan_approval` held under a concern, supplying the override and a stated reason
- **THEN** the answer succeeds, the ticket proceeds exactly as a normal approval would, and the override — its reason, who invoked it, and when — is recorded and visible on the ticket

#### Scenario: An override reason is required

- **WHEN** a human attempts to override a held approval without supplying a reason
- **THEN** the answer is still refused with the same distinct error as an unoverridden attempt

#### Scenario: An override on an unheld decision changes nothing

- **WHEN** a human answers `approve` on a decision that is not held, while also supplying an override and a reason
- **THEN** the answer succeeds exactly as it would without the override, and nothing about an override is recorded

#### Scenario: A worker that never revises does not strand the human

- **WHEN** a `plan_approval` is held under a concern and the ticket's worker retires, fails, or is never relaunched
- **THEN** the human can still override the hold and answer the decision, with no dependency on the worker's state

#### Scenario: An unreviewed card can be overridden without the weaver

- **WHEN** a card's review state is **not looked at yet**, the weaver is paused, failed, out of quota, or has never run, and the human answers the approving option with the override and a stated reason
- **THEN** the answer succeeds, the ticket proceeds, and the override — naming the pending review, its reason, who invoked it, and when — is recorded and visible on the ticket, with no dependency on the weaver's state

## ADDED Requirements

### Requirement: An unreviewed approval states plainly that it is waiting on the weaver's review

A `plan_approval`, `merge_approval`, or `action_approval` whose review state is **not looked at yet** and which is still `open` SHALL present that fact plainly wherever its review state is shown: that its approving action is waiting on the weaver's review, and that a deliberate override exists. The card SHALL still appear in the chat and in Needs you — captain asked for it to be surfaced, only not to be approvable yet.

The approving action SHALL NOT be offered on such a card while the state is **not looked at yet**; the non-approving actions (`revise`/`reject` on a plan or action approval, the non-approving option on a merge approval) SHALL remain available. The card SHALL make clear why the approving action is withheld, so its absence is not mistaken for a fault.

The hold SHALL lift the moment the weaver marks the decision **looked at** (or replaces it with a **looked at, with concerns** mark, which is its own hold). A decision that is no longer `open` (answered, superseded, withdrawn, expired) SHALL NOT present as waiting on review.

#### Scenario: An unreviewed card says it is waiting on the weaver

- **WHEN** an open `plan_approval` is rendered while its review state is **not looked at yet**
- **THEN** the card states plainly that it is waiting on the weaver's review, in addition to its existing unseen review line

#### Scenario: The approve action is withheld while unreviewed and the others are not

- **WHEN** an open review-carrying decision whose review state is **not looked at yet** is rendered
- **THEN** its approving action is not offered, while its non-approving actions remain available and its deliberate override is offered

#### Scenario: Marking a card looked lifts the unreviewed hold

- **WHEN** an open `plan_approval` whose review state is **not looked at yet** is marked **looked at** by the weaver
- **THEN** the approving answer is accepted without an override and the card presents as reviewed rather than as waiting on review

#### Scenario: An answered unreviewed card no longer presents as waiting

- **WHEN** a review-carrying decision answered while **not looked at yet** is rendered afterwards
- **THEN** it shows the answer as before, without a waiting-on-review statement, because there is nothing left to approve
