## Purpose

Defines what the shipped worker skills must say about a plan revised while its approval card is still
held: that no transition is needed while the ticket is `proposed` because the daemon republishes the
changed plan at the end of the turn, that the worker must never move the ticket to `proposing` by
hand, and that requesting `proposed` applies only when the ticket is already in `proposing`.

## ADDED Requirements

### Requirement: The worker skills say how a plan revised while `proposed` is published

The shipped worker skills (`skills/weave-ai-worker/SKILL.md` and `skills/weave-ai-openspec/SKILL.md`)
SHALL state that when a plan is revised while the ticket is still `proposed` — in answer to weaver
concerns or to steering — no transition is needed: the daemon republishes the changed plan at the end
of the worker's turn, so the revised artifacts reach a fresh approval card without the worker moving
the ticket. They SHALL state that the worker never returns the ticket to `proposing` by hand, or
otherwise transitions the ticket itself, to publish a revision. They SHALL make clear that requesting
`proposed` applies only when the ticket is already in `proposing` — the revise path — and not as a way
to republish a plan whose ticket is still `proposed`.

The guidance SHALL be consistent with the existing revision guidance: the worker changes the planning
artifacts only, never the code, and a revised plan supersedes the approval it answered.

#### Scenario: The openspec skill states that a revised plan is republished without a transition

- **WHEN** the shipped `skills/weave-ai-openspec/SKILL.md` revision guidance is read as source
- **THEN** it states that when the ticket is still `proposed` the daemon republishes a revised plan at
  the end of the worker's turn, so no transition by the worker is needed

#### Scenario: The worker skill states the same

- **WHEN** the shipped `skills/weave-ai-worker/SKILL.md` is read as source
- **THEN** it states that a plan revised while `proposed`, in answer to weaver concerns or steering,
  reaches a fresh card because the daemon republishes it at the end of the worker's turn

#### Scenario: Requesting `proposed` is reserved for the proposing status

- **WHEN** the worker skills' guidance on publishing a revised plan is read as source
- **THEN** they state that requesting `proposed` applies only when the ticket is in `proposing`
- **AND** neither skill instructs the worker to move a `proposed` ticket back to `proposing` by hand
  to publish the revision
