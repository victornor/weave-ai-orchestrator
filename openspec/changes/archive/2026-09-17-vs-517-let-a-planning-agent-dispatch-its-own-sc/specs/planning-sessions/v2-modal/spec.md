## ADDED Requirements

### Requirement: A scout draft in a drafting plan can be dispatched from the planning surface

Each `scout` draft in a `drafting` plan SHALL show a **Dispatch** action in the planning surface,
available only for that draft kind and only while its plan is `drafting` and the draft has not already
been dispatched. Activating it starts that scout's ticket without submitting the rest of the plan.

#### Scenario: The dispatch action is shown for a scout draft

- **WHEN** captain views a `scout` draft in a `drafting` plan that has not yet been dispatched
- **THEN** a Dispatch action is shown for that draft

#### Scenario: The dispatch action is not shown for other draft kinds

- **WHEN** captain views a `change`, `task`, or `operational` draft
- **THEN** no dispatch action is shown for it

#### Scenario: Dispatching starts the scout without affecting other drafts

- **WHEN** captain activates the Dispatch action on a scout draft
- **THEN** that draft's ticket starts running, and every other draft in the plan remains an unfiled
  draft

### Requirement: A dispatched scout's state is visible on its draft, without leaving the plan

Each dispatched scout draft SHALL show, in the planning surface, which of dispatched-and-running,
reported, or failed it currently is, updating without a manual reload, so captain does not need the
work page to see it.

#### Scenario: A running dispatched scout shows as running

- **WHEN** a scout draft has been dispatched and its ticket has not yet finished
- **THEN** the draft shows that it is dispatched and running

#### Scenario: A finished dispatched scout shows that its report has arrived

- **WHEN** a dispatched scout's ticket finishes and its report reaches the planning agent
- **THEN** the draft shows that its report has arrived, without captain reloading the page

#### Scenario: The Dispatch action is gone once a draft has been dispatched

- **WHEN** captain views a scout draft that has already been dispatched
- **THEN** no Dispatch action is shown for it, replaced by its current state
