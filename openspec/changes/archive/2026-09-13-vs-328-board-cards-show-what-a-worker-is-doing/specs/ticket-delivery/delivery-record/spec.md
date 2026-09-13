## ADDED Requirements

### Requirement: The delivery record carries the pull request's check tally

When the daemon refreshes a ticket's pull request from the forge, it SHALL record on that ticket's
delivery the rolled-up check state and the count of checks that passed out of the count reported, so a
surface showing the ticket can render the pull request's checks without asking the forge again. The
tally SHALL be written whenever it differs from what is recorded, independent of whether the pull
request's own state changed, and recording it SHALL make the change observable to a surface showing
the ticket. A forge that reports no checks SHALL record no tally, and a forge that cannot be reached
SHALL leave the previous record in place.

The tally SHALL be refreshed on the same reconcile that refreshes the pull request's state, so a
change in the checks is reflected on the ticket without opening the pull request.

#### Scenario: An open pull request's checks are recorded

- **WHEN** the daemon refreshes an open pull request whose rollup reports a passed and a total count
- **THEN** the ticket's delivery carries that passed/total tally and the rolled-up check state

#### Scenario: Checks change while the pull request stays open

- **WHEN** a pull request stays open and its checks change from one passing count to another
- **THEN** the ticket's recorded tally is updated, without waiting for the pull request's state to
  change

#### Scenario: A forge with no checks records none

- **WHEN** the daemon refreshes a pull request whose rollup is empty
- **THEN** the ticket's delivery carries no check tally and does not read as a failure

#### Scenario: A forge error leaves the record

- **WHEN** the forge cannot be reached during a refresh
- **THEN** the ticket's delivery keeps the check tally it already had
