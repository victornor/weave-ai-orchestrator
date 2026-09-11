## MODIFIED Requirements

### Requirement: Review is never a gate on answering

A human SHALL be able to answer a `plan_approval`, `merge_approval`, or `action_approval` at any moment regardless of its conductor review state, with one exception: an **approving** answer (the option that would move the ticket forward — `approve` on `plan_approval` and `action_approval`, `approve` on `merge_approval`) on a decision whose conductor review state is currently **looked at, with concerns** SHALL be refused while that decision is still `open`, unless answered with a deliberate override (see "A human can override a held approval").

Outside that one case, the answer path SHALL NOT wait for a review, SHALL NOT refuse an answer because the state is **not looked at yet** or **looked at**, SHALL NOT queue the answer on a review, and SHALL NOT add latency that is a function of the review state. A non-approving answer (`revise`, `reject` on `plan_approval`/`action_approval`; the non-approving option on `merge_approval`) SHALL NEVER be refused on account of the review state, regardless of what that state is.

The refusal SHALL be a distinct, identifiable outcome — never the same error a caller gets for answering a decision that is not `open`, and never silent. It SHALL name what is being waited on.

The refusal applies equally to every actor that can answer a decision, including the system actor that answers a `merge_approval` on a YOLO ticket once its checks pass: that automatic answer SHALL be refused exactly as a human's would be, and the ticket SHALL remain `in_review` with the `merge_approval` still `open` and still visible to its human owner. (A ticket delivered under `auto_merge` never raises a `merge_approval` in the first place, YOLO or not, and so has no decision for this requirement to hold — that is unrelated pre-existing behavior, not a case this requirement covers.)

While a conductor review is in progress — the conductor has been woken about the decision but has not yet marked it — the decision SHALL still read as **not looked at yet** and SHALL still be answerable, including with its approving option.

#### Scenario: Approving an unseen plan succeeds immediately

- **WHEN** a human answers `approve` on an open `plan_approval` whose review state is **not looked at yet**
- **THEN** the answer is recorded at once, the ticket proceeds exactly as it would have before this requirement existed, and nothing in the answer path waited on a review

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
- **THEN** the daemon answers it as the system actor without waiting for a conductor review mark, exactly as before this requirement existed, because a review mark cannot yet exist for a decision that was only just created

#### Scenario: An unattended merge held by a concern is not silently approved

- **WHEN** a YOLO ticket's `merge_approval` is open, its review state is **looked at, with concerns**, and its checks pass
- **THEN** the automatic approval is refused exactly as a human's would be, the ticket stays `in_review`, and the `merge_approval` remains `open` for its human owner to act on

#### Scenario: Captain answers while the conductor is still reading

- **WHEN** the conductor has been woken about an open `merge_approval` but has not yet marked it, and the human answers it
- **THEN** the answer is recorded, the review state at that moment is still **not looked at yet**, and the conductor may still mark it afterwards as after-the-fact

## ADDED Requirements

### Requirement: A held approval lifts when it stops being the live decision

An approving answer refused under "Review is never a gate on answering" SHALL become answerable again the moment that specific decision is no longer the live question for its ticket — most concretely, when it is superseded by a freshly raised decision of the same kind for the same ticket. A freshly raised `plan_approval` or `merge_approval` SHALL always start at **not looked at yet**, per the existing supersession behavior, and SHALL carry no hold of its own until the conductor marks it.

The hold SHALL NOT be lifted by editing, re-marking, or otherwise mutating the same decision row's review state through any path other than a fresh conductor review mark on that same still-open decision (see "The conductor asserts the review; nothing else infers it"). There SHALL be no separate "revision" flag, counter, or document-revision comparison that this requirement depends on: whether the decision is still `open` and still marked **looked at, with concerns** is sufficient and the only signal.

A decision that stops being `open` for any reason other than being answered (superseded, withdrawn, expired) SHALL simply no longer be answerable at all, per its existing status handling — the hold has nothing further to say about it.

#### Scenario: A re-proposed plan is not held by the prior card's concern

- **WHEN** an open `plan_approval` is marked **looked at, with concerns**, the human answers `revise`, the worker reworks the plan, and the ticket is re-proposed
- **THEN** a new `plan_approval` decision is created starting at **not looked at yet**, the prior decision is superseded and no longer answerable, and the human can approve the new decision without an override

#### Scenario: A re-delivered ticket's fresh merge approval is not held by the prior card's concern

- **WHEN** an open `merge_approval` is marked **looked at, with concerns**, the human requests changes, the worker delivers again, and the ticket re-enters `in_review`
- **THEN** a new `merge_approval` decision is created starting at **not looked at yet**, and the human can approve it without an override

#### Scenario: Marking the same open decision again does not lift its own hold

- **WHEN** an open `plan_approval` is marked **looked at, with concerns** and the conductor asserts the same mark again with different note text, without the ticket having moved through a revision cycle
- **THEN** the decision is still held: an approving answer without an override is still refused

### Requirement: A human can override a held approval

A human SHALL have a way to answer an approving option on a decision held under "Review is never a gate on answering" without waiting for a revision. That path SHALL require a deliberate action distinct from the normal approving answer — at minimum, a stated reason for overriding the hold — and SHALL NOT be satisfiable by resubmitting the same answer that was refused.

An override SHALL be recorded: who invoked it, when, on which decision, and the reason given. The record SHALL be visible on the ticket the decision belongs to, not only in an internal log.

An override SHALL only ever be considered on a decision that is actually held. Supplying an override on a decision that is not held, or on a non-approving answer, SHALL have no effect — it is neither stored nor recorded, and the answer proceeds exactly as it would without it.

An override SHALL be available regardless of whether the ticket's worker is still active, paused, failed, or retired: the human's path past the hold SHALL NOT depend on the worker's state.

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

### Requirement: A held decision states plainly that it is waiting on a revision

A `plan_approval`, `merge_approval`, or `action_approval` currently held under a concern SHALL present that fact plainly wherever its review state is shown: that it is waiting for a revision, and that a deliberate override exists. This is in addition to, not a replacement for, the existing concern line and note.

A decision that is marked **looked at, with concerns** but is no longer `open` (already answered, superseded, withdrawn, or expired) SHALL NOT present as held — it is not answerable at all, for reasons unrelated to this hold.

#### Scenario: A held card says so

- **WHEN** a `plan_approval` is open and marked **looked at, with concerns**
- **THEN** its rendering states plainly that approval is held pending a revision, in addition to showing the concern's own line and note

#### Scenario: An answered concern does not present as held

- **WHEN** a `plan_approval` marked **looked at, with concerns** has already been answered
- **THEN** its rendering shows the concern as before this requirement existed, without a held-for-approval statement, since there is nothing left to approve
