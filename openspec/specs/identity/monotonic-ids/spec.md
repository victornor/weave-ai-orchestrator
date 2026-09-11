# identity/monotonic-ids Specification

## Purpose
Every identifier the daemon issues through its shared id factory is a ULID that sorts in creation order, including two ids generated in the same millisecond, so any list that orders by timestamp then id is a total order of creation.

## Requirements

### Requirement: Newly issued ids sort in creation order

The daemon SHALL issue each new row id as a ULID whose lexicographic order matches the order in which the ids were generated. Two ids generated in the same millisecond SHALL still sort in that generation order: the later id SHALL compare greater than the earlier id. Existing ids already stored SHALL keep the values they have; this capability SHALL NOT rewrite or migrate them.

A query that orders by a millisecond-precision timestamp and then by id SHALL therefore return rows that share a timestamp in creation order when the timestamp column is ascending, and in reverse creation order when the timestamp column is descending.

#### Scenario: Many ids in one millisecond are strictly increasing

- **WHEN** the daemon generates a large number of ids in a tight loop that completes within a single millisecond
- **THEN** each id is strictly greater than the one generated before it

#### Scenario: Timestamp-then-id order matches creation

- **WHEN** two rows are inserted in sequence with the same timestamp value and ids issued by the factory
- **THEN** `ORDER BY <timestamp> ASC, id ASC` returns them in insertion order
- **AND** `ORDER BY <timestamp> DESC, id DESC` returns them in reverse insertion order

#### Scenario: Stored ids are left alone

- **WHEN** this capability is deployed onto a database that already has rows
- **THEN** every existing id is unchanged
