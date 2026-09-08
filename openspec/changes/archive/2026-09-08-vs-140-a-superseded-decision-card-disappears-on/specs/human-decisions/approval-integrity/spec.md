## ADDED Requirements

### Requirement: Acting on a decision that has already left `open` status explains what happened

An attempt to answer a decision that is not `open` SHALL be refused, and the refusal SHALL name what
happened to it in terms the human did not have to infer: that it was superseded by a newer decision,
that it was already answered, or that it expired. When the decision was superseded, the refusal SHALL
identify the decision that replaced it, so the surface presenting the error can offer a way to it.

This refusal SHALL NOT be applied to, nor treated as an answer of, any decision other than the one
named in the request — in particular, a stale answer sent for a superseded decision SHALL NOT be
forwarded to, or recorded against, the decision that superseded it. The human answered the thing they
read; nothing acts on their behalf against a decision they have not seen.

#### Scenario: A stale approve names the replacement

- **WHEN** a human answers a `plan_approval` decision that was superseded before the answer reached
  the server
- **THEN** the answer is refused, the refusal states that the plan changed, and it identifies the
  decision that replaced it

#### Scenario: A stale answer never lands on the replacement

- **WHEN** a human answers a decision that has been superseded
- **THEN** the decision that replaced it is unaffected — its status, and every field an answer would
  set, are exactly as they were before the stale answer was sent

#### Scenario: An already-answered decision explains itself

- **WHEN** a human answers a decision that was already answered by another surface or device
- **THEN** the refusal states that it was already answered, without implying anything about their own
  answer having taken effect

#### Scenario: An expired decision explains itself

- **WHEN** a human answers a decision that expired before the answer reached the server
- **THEN** the refusal states that it expired
