# planning-sessions/planner-tools — delta

## ADDED Requirements

### Requirement: The planner can name its own plan and can never overwrite a title captain gave

The planning agent SHALL have a capability to set a short title — at most six words — on the one plan
its session belongs to, so the plan's tab can be labelled from the plan's own conversation. The
capability SHALL write only a title drawn from that plan's conversation; it SHALL NOT change any
other field of the plan. Once a plan's title was given by captain, the capability SHALL refuse to
change it, and the planner SHALL have no other path that renames a plan.

#### Scenario: The planner names its plan from the conversation

- **WHEN** the planning agent sets a short title on the plan its session belongs to, before captain
  has named it
- **THEN** the plan's title becomes that title, recorded as auto-generated, and the tab shows it

#### Scenario: The planner may replace a still-auto title

- **WHEN** the planning agent sets a new short title on a plan whose current title is still
  auto-generated
- **THEN** the plan's title becomes the new title

#### Scenario: A captain-given title is never overwritten

- **WHEN** captain has named a plan, and the planning agent attempts to set a title on it
- **THEN** the attempt is refused, no title change is stored, and captain's title remains

#### Scenario: The planner cannot title another plan

- **WHEN** the planning agent attempts to set a title on a plan other than the one its session
  belongs to
- **THEN** the attempt is refused and that other plan's title is unchanged
