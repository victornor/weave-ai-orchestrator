# agent-prompts/plan-intake Specification

## Purpose
Defines how the weaver's own guidance treats a submitted draft plan: as a decision captain already
made, to be executed faithfully, not a proposal to second-guess or redo.

## Requirements

### Requirement: The weaver does not re-plan a submitted plan's sequencing or scope

When acting on a submitted plan, the weaver's guidance SHALL instruct it to create tickets matching
the plan's drafts as given — their ordering, dependencies, roles and tiers — and SHALL NOT instruct it
to re-decompose, resequence, or second-guess decisions captain already made while drafting the plan.

#### Scenario: The weaver's instructions do not invite re-decomposition

- **WHEN** the weaver's guidance for handling a submitted plan is rendered
- **THEN** it instructs creating tickets matching the plan's drafts, and does not instruct
  re-splitting, merging, or reordering drafts on the weaver's own judgement

#### Scenario: A draft the weaver would have written differently is still created as given

- **WHEN** the weaver processes a submitted plan containing a draft it would have scoped differently
  on its own
- **THEN** it creates the ticket matching the draft as submitted, rather than altering the draft's
  scope

### Requirement: The weaver's guidance covers reading, creating from, and reporting on a submitted plan

The weaver's standing instructions SHALL describe the full lifecycle of handling a submitted plan:
reading it, creating tickets from its drafts in dependency order, and reporting the outcome, including
any draft that could not be turned into a ticket.

#### Scenario: The guidance names all three steps

- **WHEN** the weaver's rendered instructions describe handling a submitted plan
- **THEN** they cover reading the plan, creating tickets from it, and reporting the outcome to captain
