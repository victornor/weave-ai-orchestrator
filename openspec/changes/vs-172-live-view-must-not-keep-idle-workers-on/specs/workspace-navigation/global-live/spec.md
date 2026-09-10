## ADDED Requirements

### Requirement: A worker on a terminal ticket has no global Live cell

When a ticket reaches `done` or `cancelled`, its worker SHALL NOT have a cell on the global Live
page. Membership stays the same liveness rule as per-workspace Live
(`workspace-navigation/live-floor`): a live worker between turns on a ticket that is not terminal
SHALL still have a cell.

#### Scenario: A done ticket's worker is not on global Live

- **WHEN** a worker's ticket in any hosted workspace reaches `done`
- **THEN** that worker has no cell on the global Live page

#### Scenario: A cancelled ticket's worker is not on global Live

- **WHEN** a worker's ticket in any hosted workspace reaches `cancelled`
- **THEN** that worker has no cell on the global Live page
