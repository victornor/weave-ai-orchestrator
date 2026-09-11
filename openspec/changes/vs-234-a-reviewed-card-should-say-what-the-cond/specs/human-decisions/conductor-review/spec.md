## MODIFIED Requirements

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
