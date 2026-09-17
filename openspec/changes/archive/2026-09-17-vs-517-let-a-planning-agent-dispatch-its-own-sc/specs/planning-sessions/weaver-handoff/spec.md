## MODIFIED Requirements

### Requirement: Tickets are created in dependency order, with real blockers

The weaver SHALL create a real ticket for each draft in a submitted plan that does not already have
one, such that a draft with a dependency on another draft in the same plan results in a real ticket
that is blocked by the ticket created from — or already existing for — that other draft. A draft that
was already dispatched before submission (`planning-sessions/scout-dispatch`) already has a ticket and
SHALL NOT have a second one created for it; its existing ticket is used wherever another draft's
dependency names it. A draft's dependency SHALL NOT be lost, reordered incorrectly, or represented only
as descriptive text.

#### Scenario: A dependent draft's ticket is blocked by its dependency's ticket

- **WHEN** draft B depends on draft A in a submitted plan
- **THEN** the real ticket created from draft B is blocked by the real ticket created from draft A

#### Scenario: Independent drafts create independently

- **WHEN** two drafts in a submitted plan have no dependency between them
- **THEN** their real tickets are created with no blocking relationship between them

#### Scenario: An already-dispatched draft is not filed again

- **WHEN** a submitted plan contains a draft that was already dispatched before submission
- **THEN** ticket creation for the submission does not create a second ticket for that draft, and its
  existing ticket is what the plan's other created tickets treat as its blocker where named
