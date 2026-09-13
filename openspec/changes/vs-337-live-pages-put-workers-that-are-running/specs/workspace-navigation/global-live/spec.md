## ADDED Requirements

### Requirement: Global Live orders running workers first across the page

The global Live page SHALL order its cells so that workers with an in-progress run come before live
workers between turns, exactly as the per-workspace Live page does
(`workspace-navigation/live-floor`). The page is not grouped by workspace today, so the order
SHALL apply across the whole page rather than restarting per workspace, and within each group the
newest worker SHALL come first.

The between-turns grace period, the rule that reordering does not change which cells hold a run-tail
`EventSource` slot or reopen a stream, and the rule that a moved cell keeps its saved size SHALL
hold on global Live exactly as on the per-workspace page.

#### Scenario: Running workers across workspaces come first

- **WHEN** one workspace has a worker between turns and another has a worker with an in-progress
  run, and global Live is open
- **THEN** the running worker's cell appears before the waiting worker's cell

#### Scenario: The order does not restart per workspace

- **WHEN** several workspaces each contribute running and between-turns cells to global Live
- **THEN** every running cell appears before every between-turns cell across the whole page

#### Scenario: A just-finished global cell holds its place

- **WHEN** a global Live cell's run ends and its worker is between turns
- **THEN** the cell stays in the running group for the grace period, and a new run inside the
  window keeps it there
