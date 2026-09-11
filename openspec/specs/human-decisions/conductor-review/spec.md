# human-decisions/conductor-review Specification

## Purpose
Records, on a plan, merge, or action approval, whether the conductor has looked at the work the human is about to grant — and any concern that look produced — without turning that look into a gate or an endorsement of correctness.

## Requirements

### Requirement: Plan, merge and action approvals carry a conductor review state

A `plan_approval`, `merge_approval`, or `action_approval` decision SHALL carry a conductor review state with exactly three values:

- **not looked at yet** — the default at creation, including for a repaired or superseded-and-re-raised approval
- **looked at** — the conductor has read the work and has nothing to flag
- **looked at, with concerns** — the conductor has read the work and raised a concern

No other decision kind SHALL carry this state. Hire, discard, retry, question, concern, gate-finding, and generic approval decisions SHALL NOT grow a review field, SHALL NOT accept a review mark, and SHALL NOT display as if they had been reviewed.

The state records that the conductor looked. It SHALL NOT be described, stored, or presented as the conductor vouching for correctness or becoming accountable for the decision.

A decision of a carrying kind that already existed when this requirement landed, and has never been marked, SHALL read as **not looked at yet**.

#### Scenario: A newly raised plan approval is unseen

- **WHEN** a `plan_approval` decision is created
- **THEN** its conductor review state is **not looked at yet**
- **AND** it has no review timestamp and no concern text

#### Scenario: A newly raised merge approval is unseen

- **WHEN** a `merge_approval` decision is created
- **THEN** its conductor review state is **not looked at yet**

#### Scenario: A newly raised action approval is unseen

- **WHEN** an `action_approval` decision is created
- **THEN** its conductor review state is **not looked at yet**

#### Scenario: A repaired approval starts unseen

- **WHEN** the daemon raises a fresh `plan_approval` or `merge_approval` because the ticket was stranded without one
- **THEN** the new decision's conductor review state is **not looked at yet**, even if an earlier superseded approval on the same ticket had been marked

#### Scenario: Other kinds refuse a review mark

- **WHEN** a review is asserted against a `question`, `concern`, `hire_approval`, `discard_approval`, `retry_approval`, or `gate_finding` decision
- **THEN** the write is refused, that decision is unchanged, and no review state appears on it

### Requirement: The conductor asserts the review; nothing else infers it

The conductor review state SHALL change only when the conductor explicitly marks the decision looked-at or looked-at-with-concerns. The daemon SHALL NOT infer the state from the conductor being woken, from a digest that names the ticket or the decision, from a comment, from `ac_ask`, from `ac_human_send`, from a turn starting or ending, or from any other side effect.

Only the conductor agent SHALL be able to assert the mark. A worker's attempt SHALL be refused and SHALL leave the decision unchanged. A human answering the decision SHALL NOT set, clear, or alter the review state.

Marking **looked at, with concerns** SHALL require a non-empty concern summary stored on the decision. Marking **looked at** SHALL equally require a non-empty note stored on the decision, in the same field the concern summary occupies: the conductor's stated reason the work is clean, the same one or two sentences it would otherwise write to the human in chat. Either mark SHALL replace whatever note a previous mark left. A mark without its note SHALL be refused, whether the decision is open or already answered. The conductor MAY update a mark already on the decision (including replacing a concern with a reasoned clean mark, or adding a concern after a clean look). Each successful mark records the time it was asserted.

The conductor SHALL NOT be able to set the state back to **not looked at yet** once a mark exists: absence is only the honest default, never a retractable claim.

#### Scenario: The conductor marks a plan as looked at

- **WHEN** the conductor asserts a **looked at** mark on an open `plan_approval`, with a non-empty note saying why the plan is clean
- **THEN** the decision's review state becomes **looked at**, with a review timestamp, and the note is stored on the decision

#### Scenario: The conductor marks a merge with a concern

- **WHEN** the conductor asserts a **looked at, with concerns** mark on an open `merge_approval`, with a non-empty concern summary
- **THEN** the decision's review state becomes **looked at, with concerns**, the summary is stored on the decision, and a review timestamp is recorded

#### Scenario: A clean mark without a note is refused

- **WHEN** the conductor asserts a **looked at** mark with no note, or only whitespace
- **THEN** the write is refused and the decision's review state is unchanged

#### Scenario: A clean mark replaces a previous concern

- **WHEN** a decision carries a **looked at, with concerns** mark with its summary, and the conductor later asserts a **looked at** mark with a new note
- **THEN** the state becomes **looked at**, the note replaces the old summary, and the review timestamp is the newer mark's

#### Scenario: A concern mark without text is refused

- **WHEN** the conductor asserts **looked at, with concerns** without a non-empty concern summary
- **THEN** the write is refused and the decision's review state is unchanged

#### Scenario: A worker cannot stamp a review

- **WHEN** a worker attempts to assert a conductor review mark on a `plan_approval`
- **THEN** the write is refused with a forbidden error and the decision remains **not looked at yet**

#### Scenario: A digest wake does not mark the decision reviewed

- **WHEN** the conductor is woken because a `plan_approval` or `merge_approval` was created, and that turn ends without an explicit review mark
- **THEN** the decision's review state is still **not looked at yet**

#### Scenario: A comment does not mark the decision reviewed

- **WHEN** the conductor comments on the ticket a `merge_approval` belongs to, without asserting a review mark
- **THEN** the decision's review state is still **not looked at yet**

#### Scenario: Answering does not alter the review state

- **WHEN** the human answers a `plan_approval` whose review state is **not looked at yet**
- **THEN** the decision is answered exactly as before this requirement existed, and its review state remains **not looked at yet**

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

### Requirement: A review that lands after the answer is visibly after the fact

A conductor review mark MAY be recorded after the decision has already been answered. That write SHALL succeed for an `answered` `plan_approval`, `merge_approval`, or `action_approval`, and SHALL store the review timestamp as the time of the mark, not as a time at or before `answeredAt`.

A review recorded when `reviewedAt` is strictly later than `answeredAt` SHALL be distinguishable, on the decision and on every card that shows it, from a review recorded before the answer. The daemon SHALL NOT backfill, clamp, or rewrite `reviewedAt` to look prior.

A mark SHALL be refused on a decision whose status is `superseded`, `withdrawn`, or `expired`: those decisions are no longer the live question, and a mark on them would be read against the wrong card.

#### Scenario: A look after approve is stored as after the fact

- **WHEN** a `merge_approval` was answered at 02:54 and the conductor asserts a **looked at** mark at 02:56
- **THEN** the decision stores `reviewedAt` as 02:56, keeps `answeredAt` as 02:54, and any reader can tell the look arrived after the answer

#### Scenario: A concern after approve is stored as after the fact

- **WHEN** a `plan_approval` was already answered and the conductor then asserts **looked at, with concerns**
- **THEN** the concern summary is stored, the review timestamp is after `answeredAt`, and the state is **looked at, with concerns** rather than rewritten to look like a prior clean look

#### Scenario: A superseded approval cannot be marked

- **WHEN** the conductor asserts a review mark on a `plan_approval` that has been superseded by a newer plan revision
- **THEN** the write is refused and the replacement decision is unaffected

### Requirement: The mark stays meaningful by remaining costly and quiet

Both marks SHALL cost the conductor a written reason: a clean mark without its note is refused exactly as a concern without its summary is, and what the clean mark asserts is precisely its note. The **not looked at yet** state SHALL remain the one the card emphasises: it is the honest default and the reason this capability exists. A clean mark SHALL read as the conclusion of a review — that the conductor reviewed the work and found nothing to object to, with that reasoning shown beside the decision — and SHALL NOT claim more than that: nothing in the system may say the conductor approved the work, signed off, vouches for its correctness, or takes accountability for it, because approving is the human's act. **Looked at, with concerns** SHALL remain the loudest state, and SHALL only be reachable by supplying concern text that is then shown to the human.

If the mark still degenerates into a reflex, the next change SHALL raise the cost of a clean look further. It SHALL NOT start inferring the mark from activity.

Nothing in the system SHALL auto-complete a clean **looked at** mark as a turn-closing ritual, a digest side effect, or a default the conductor has to opt out of.

#### Scenario: A turn that does not mark leaves the default

- **WHEN** a conductor turn that was woken about an open `plan_approval` ends without an explicit review mark
- **THEN** the decision remains **not looked at yet**

#### Scenario: Clean look is not an endorsement field

- **WHEN** a decision is marked **looked at**, with its note
- **THEN** the stored state and any text derived from it say that the conductor reviewed the work and found nothing to object to, and do not say that the conductor approved, signed off, or vouches for the work

#### Scenario: A clean mark states its conclusion and its reason

- **WHEN** a card shows a decision whose review state is **looked at** and whose mark carries a note
- **THEN** the card's copy conveys the outcome of the review rather than the bare activity of looking, and the note is shown with it

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
