## Purpose

The conductor-facing briefing snapshot and its rendered `Needs you` section: which open human-owned
decisions the briefing carries, the order it carries them in, how a cap over that list is reported,
and the age each carried card shows. Its job is that a card waiting for the human is never silently
invisible to the conductor — either the card appears, or the section says how many did not.

## ADDED Requirements

### Requirement: The briefing carries open human-owned decisions longest-waiting first

The briefing snapshot's `Needs you` list SHALL contain the workspace's open decisions whose owner is
the human, ordered oldest-first by creation time, so that a cap over the list sheds the freshest
cards rather than the stalest. Decisions that are not open, or that are owned by the weaver, SHALL
NOT appear.

#### Scenario: Waiting cards are ordered oldest first

- **WHEN** a workspace has three open human-owned decisions created one after another
- **THEN** the briefing's `Needs you` list carries them oldest first

#### Scenario: Only open human-owned decisions appear

- **WHEN** a workspace has a weaver-owned decision and an answered human-owned decision alongside
  an open human-owned one
- **THEN** only the open human-owned one appears in the `Needs you` list

#### Scenario: A cap drops the freshest, not the stalest

- **WHEN** more open human-owned decisions exist than the briefing's `Needs you` cap
- **THEN** the oldest decisions are the ones carried, and the newest are the ones left out

### Requirement: Truncation of the Needs you list is stated, never silent

When the cap leaves one or more open human-owned decisions out of the briefing, the rendered
`Needs you` section SHALL state how many were not shown. When the cap hides nothing, no such
statement SHALL be rendered. Every open human-owned decision is therefore either present in the
section or counted by it — none can be both absent and unmentioned.

This SHALL hold wherever the snapshot is rendered into the conductor's briefing, not only the CLI's
four-section render: the weaver renders the section from the raw snapshot and never sees the CLI
render, so its briefing skill SHALL be given the same overflow case and the total it reads.

#### Scenario: An over-limit section states how many were not shown

- **WHEN** the briefing carries its cap of `Needs you` cards and more open human-owned decisions
  remain
- **THEN** the rendered `Needs you` section states how many were not shown (e.g. `3 more waiting`)

#### Scenario: An under-limit section says nothing about truncation

- **WHEN** the open human-owned decisions all fit within the cap
- **THEN** the rendered section carries no truncation statement

#### Scenario: The weaver's rendering contract carries the overflow case

- **WHEN** the weaver's briefing skill describes the `Needs you` block
- **THEN** it states that a snapshot carrying more open decisions than items reports how many more
  are waiting, from the snapshot's total, rather than presenting the capped list as the whole truth

### Requirement: The Needs you section always renders, with a defined empty state

The briefing render SHALL always produce a `Needs you` section, whether the snapshot has any cards
or not. With no cards it SHALL render the section's empty-state line rather than an empty list or a
missing section.

#### Scenario: An empty list renders the empty state

- **WHEN** the briefing snapshot carries no `Needs you` cards
- **THEN** the rendered `Needs you` section is present, reports no cards, and shows its empty-state
  line

### Requirement: A carried card's line shows the decision's age

Each card the `Needs you` section renders SHALL carry the decision's age, so that a card that has
waited for days is distinguishable at a glance from one raised a minute ago.

#### Scenario: A stale card reads as stale

- **WHEN** a decision created three days ago is carried in the `Needs you` section
- **THEN** its rendered line carries an age of `3d`
