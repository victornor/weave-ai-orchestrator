## ADDED Requirements

### Requirement: Dispatching a scout tells the planning agent the ticket's identifier

When the planning agent dispatches a scout draft, the result it receives SHALL carry the created
ticket's identifier, so it can name what it dispatched without a further read. The planning agent's
instructions SHALL tell it to name that identifier in its next reply to captain.

#### Scenario: The dispatch result carries the identifier

- **WHEN** the planning agent dispatches a scout draft
- **THEN** the tool result it receives includes the created ticket's identifier

#### Scenario: Captain's own dispatch is unaffected

- **WHEN** captain dispatches a scout draft directly from the Plan tab, rather than the planning
  agent
- **THEN** the dispatch succeeds exactly as before, and the result's shape for that path is unchanged
