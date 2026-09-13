## Purpose

Defines what the shipped weaver guidance must say about the two review marks on a plan, merge or
action approval: that `concerns` keeps holding the approving answer until a new revision lands, and
that notes meant to be applied while building belong in a `looked` note.

## ADDED Requirements

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
