# agent-prompts/weaver-review-guidance Specification

## Purpose
Defines what the shipped weaver guidance must say about the two review marks on a plan, merge or
action approval: that `concerns` keeps holding the approving answer until a new revision lands, and
that notes meant to be applied while building belong in a `looked` note.

## Requirements

### Requirement: The weaver's review guidance says what `concerns` holds

The `weave_decision_review` tool description (`packages/server/src/tools.ts`), the weaver skill
(`skills/weave-ai-weaver/SKILL.md`), and the always-loaded weaver instruction template
(`templates/weaver.AGENTS.md.tmpl`) SHALL each state that a `concerns` mark holds the approving answer
until a new plan revision (for a `plan_approval`) or a new commit (for a `merge_approval`) lands, and
therefore that `concerns` is only for when the work must change before it is approved. They SHALL each
state that advice to apply while the work is being built belongs in a `looked` note rather than a
`concerns` mark.

They SHALL continue to say what they already say: both marks need a note that appears on the card,
`looked` means the review found nothing to object to, and neither mark is an endorsement or the
weaver's own approval.

#### Scenario: The tool description states the hold

- **WHEN** the `weave_decision_review` tool description is read as source
- **THEN** it states that `concerns` holds approval until a new plan revision (or, on a merge, a new
  commit) lands
- **AND** it states that notes meant to be applied while building go in a `looked` note

#### Scenario: The weaver skill states the hold

- **WHEN** `skills/weave-ai-weaver/SKILL.md` is read as source
- **THEN** its review paragraph states that `concerns` holds approval until a new revision lands
- **AND** it states that build-time notes go in a `looked` note

#### Scenario: The weaver instruction template states the hold

- **WHEN** `templates/weaver.AGENTS.md.tmpl` is read as source
- **THEN** the paragraph that tells the weaver to review plan, merge and action cards states that
  `concerns` holds approval until a new revision lands
- **AND** it states that build-time notes go in a `looked` note

### Requirement: The weaver's review guidance says to review the oldest unreviewed card first

The `weave-ai-weaver` skill (`skills/weave-ai-weaver/SKILL.md`) and the always-loaded weaver
instruction template (`templates/weaver.AGENTS.md.tmpl`) SHALL each state that the oldest unreviewed
approval card is reviewed first, because a card awaiting review does not itself re-wake the weaver
and further cards arrive only with the digest.

#### Scenario: The skill orders review by age

- **WHEN** `skills/weave-ai-weaver/SKILL.md` is read as source
- **THEN** its review guidance states that the oldest unreviewed approval card is reviewed first

#### Scenario: The template states why order matters

- **WHEN** `templates/weaver.AGENTS.md.tmpl` is read as source
- **THEN** its review guidance states that a card awaiting review does not re-wake the weaver and
  that further cards arrive with the digest, so the oldest is taken first

### Requirement: The weaver's review guidance says to mark every card that was read

The weaver skill and the always-loaded weaver instruction template SHALL each state that every card
the weaver has read is marked, including one it is holding for a reason outside the work, which is
marked with its waiting statement so it is not mistaken for a forgotten card. They SHALL state that
an unmarked card reads as one nobody has looked at.

#### Scenario: A held card is still marked

- **WHEN** the shipped review guidance is read as source
- **THEN** it states that a card held for a reason outside the work is marked and its waiting
  statement says what it waits on

#### Scenario: An unmarked card reads as forgotten

- **WHEN** the shipped review guidance is read as source
- **THEN** it states that a card left unmarked is indistinguishable from a card nobody has looked at

### Requirement: The weaver's review guidance says a concern wakes nobody

The weaver skill and the always-loaded weaver instruction template SHALL each state that marking a
card `concerns` does not itself wake the weaver, so when the work is revised the weaver returns and
re-reviews the card, or the revision sits unread.

#### Scenario: A revision after a concern is re-reviewed

- **WHEN** the shipped review guidance is read as source
- **THEN** it states that a `concerns` mark wakes nobody and that the weaver returns to re-review
  once the work is revised
