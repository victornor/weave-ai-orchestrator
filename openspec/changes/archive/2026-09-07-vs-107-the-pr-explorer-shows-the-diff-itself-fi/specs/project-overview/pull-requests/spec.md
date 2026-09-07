## MODIFIED Requirements

### Requirement: Opening a pull request shows its description and what it changes

Opening a listed pull request SHALL show its description, the files it changes with the number of
lines added and removed for each and in total, and the result of each of its checks. It SHALL offer
a link that opens the pull request on the forge. Its diff, file by file, SHALL also be shown, as
`project-overview/pull-request-diff` specifies.

Where the pull request belongs to a ticket that has a plan document, opening the pull request SHALL
put that plan one click away.

Which pull request is open SHALL be part of the overview's address, so that an open pull request can
be linked to and returned to, and closing it SHALL return to the list.

The section SHALL NOT offer approving, merging, reviewing or commenting on a pull request: merge
approval remains a decision.

#### Scenario: The diff summary

- **WHEN** a pull request is opened from the section
- **THEN** its description, its changed files with their additions and deletions, and its checks are
  shown, with a link to the forge

#### Scenario: The plan is one click away

- **WHEN** an opened pull request belongs to a ticket that has a plan document
- **THEN** that plan is reachable in one click

#### Scenario: An opened pull request is addressable

- **WHEN** the overview is opened at the address of one of its pull requests
- **THEN** that pull request is the one shown

#### Scenario: Read-only

- **WHEN** a pull request is opened from the section
- **THEN** nothing offers to approve it, merge it, review it or comment on it

## ADDED Requirements

### Requirement: A merge-approval card leads straight to its pull request

A merge-approval decision card SHALL offer a control that opens the project overview at the pull
request that ticket's work product names, when the ticket has one. A merge-approval card for a ticket
with no pull-request work product SHALL NOT offer this control.

#### Scenario: A pull request is one click from its merge card

- **WHEN** a merge-approval card is shown for a ticket that has a pull-request work product
- **THEN** the card offers a control that opens the project overview at that pull request

#### Scenario: Nothing to show

- **WHEN** a merge-approval card is shown for a ticket with no pull-request work product
- **THEN** the card offers no such control
