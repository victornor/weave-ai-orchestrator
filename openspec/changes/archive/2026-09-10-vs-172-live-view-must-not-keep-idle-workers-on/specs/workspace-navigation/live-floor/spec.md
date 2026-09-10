## ADDED Requirements

### Requirement: A worker on a terminal ticket has no Live cell

When a ticket reaches `done` or `cancelled`, its worker SHALL NOT have a cell on the Live page,
even if it still holds that ticket id. A live worker on a ticket that is not terminal SHALL still
have a cell between turns, as this capability already requires.

#### Scenario: A done ticket's worker is not on Live

- **WHEN** a worker's ticket reaches `done`
- **THEN** that worker has no cell on the Live page

#### Scenario: A cancelled ticket's worker is not on Live

- **WHEN** a worker's ticket reaches `cancelled`
- **THEN** that worker has no cell on the Live page
