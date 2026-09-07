## MODIFIED Requirements

### Requirement: The merging worker is told it holds the queue

The wake that admits a ticket to the active merge step SHALL tell the worker that it now holds the
project's merge slot and that its base may have moved while it waited, so that the worker syncs its
branch with that ticket's effective landing branch — its own declared landing branch, or otherwise its
project's — resolves conflicts, and re-runs the project's checks before landing.

#### Scenario: The merge turn names the queue

- **WHEN** a worker is woken because its ticket reached the front of the merge queue
- **THEN** its turn states that the ticket holds the project's merge slot and that its effective
  landing branch must be re-synced before merging

#### Scenario: A ticket's own override is named, not its project's landing branch

- **WHEN** a worker is woken because a ticket that declares its own landing branch, overriding its
  project's, reached the front of the merge queue
- **THEN** its turn states that the ticket's own declared landing branch must be re-synced before
  merging
