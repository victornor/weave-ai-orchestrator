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

Marking **looked at, with concerns** SHALL require a non-empty concern summary stored on the decision. Marking **looked at** SHALL clear any previous concern summary. The conductor MAY update a mark already on the decision (including withdrawing a concern by marking **looked at**, or adding a concern after a clean look). Each successful mark records the time it was asserted.

The conductor SHALL NOT be able to set the state back to **not looked at yet** once a mark exists: absence is only the honest default, never a retractable claim.

#### Scenario: The conductor marks a plan as looked at

- **WHEN** the conductor asserts a **looked at** mark on an open `plan_approval`
- **THEN** the decision's review state becomes **looked at**, with a review timestamp, and no concern text

#### Scenario: The conductor marks a merge with a concern

- **WHEN** the conductor asserts a **looked at, with concerns** mark on an open `merge_approval`, with a non-empty concern summary
- **THEN** the decision's review state becomes **looked at, with concerns**, the summary is stored on the decision, and a review timestamp is recorded

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

A human SHALL be able to answer a `plan_approval`, `merge_approval`, or `action_approval` at any moment regardless of its conductor review state. The answer path SHALL NOT wait for a review, SHALL NOT refuse an answer because the state is **not looked at yet** or **looked at, with concerns**, SHALL NOT queue the answer on a review, and SHALL NOT add latency that is a function of the review state.

YOLO auto-approval and a ticket's `auto_merge` flag SHALL behave exactly as they do today: they neither wait on a review nor write one.

Existing option keys, who may answer, and the effect of each answer SHALL be unchanged.

While a conductor review is in progress — the conductor has been woken about the decision but has not yet marked it — the decision SHALL still read as **not looked at yet** and SHALL still be answerable.

#### Scenario: Approving an unseen plan succeeds immediately

- **WHEN** a human answers `approve` on an open `plan_approval` whose review state is **not looked at yet**
- **THEN** the answer is recorded at once, the ticket proceeds exactly as it would have before this requirement existed, and nothing in the answer path waited on a review

#### Scenario: Approving a merge the conductor has concerns about succeeds immediately

- **WHEN** a human answers `approve` on an open `merge_approval` whose review state is **looked at, with concerns**
- **THEN** the answer is recorded at once and the merge proceeds exactly as an approve on an unmarked merge approval would

#### Scenario: YOLO does not wait on a review

- **WHEN** a project is in YOLO mode and a `plan_approval` is created
- **THEN** the daemon answers it as the system actor without waiting for a conductor review mark, and the decision's review state remains **not looked at yet** unless the conductor later marks it

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

The **not looked at yet** state SHALL be the one the card emphasises: it is the honest default and the reason this capability exists. **Looked at** SHALL be a quiet factual statement, not a green endorsement, seal, or "signed off" claim — quiet meaning understated type, never an omitted line. **Looked at, with concerns** SHALL be the loudest state, and SHALL only be reachable by supplying concern text that is then shown to the human.

If the mark degenerates into a reflex, the next change SHALL raise the cost of a clean look (for example requiring a one-line "what I checked"). It SHALL NOT start inferring the mark from activity.

Nothing in the system SHALL auto-complete a clean **looked at** mark as a turn-closing ritual, a digest side effect, or a default the conductor has to opt out of.

#### Scenario: A turn that does not mark leaves the default

- **WHEN** a conductor turn that was woken about an open `plan_approval` ends without an explicit review mark
- **THEN** the decision remains **not looked at yet**

#### Scenario: Clean look is not an endorsement field

- **WHEN** a decision is marked **looked at**
- **THEN** the stored state and any text derived from it say that the conductor looked, and do not say that the conductor approved, signed off, or vouches for the work
