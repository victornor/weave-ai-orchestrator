## ADDED Requirements

### Requirement: A release containing undelivered ticket-referencing commits says so

A completed upgrade's announcement SHALL determine, from the release directories' own git history between the previous and new release commits, how many commits carry a subject that names one of the workspace's own ticket identifiers (`<PREFIX>-<number>`). When that set contains an identifier not already present among the tickets the delivery records account for, the announcement SHALL report the discrepancy rather than omitting it: both the posted message and the conductor's wake SHALL state how many such commits have no matching delivery record, and the wake SHALL list their identifiers when they can be read from the commit subjects.

This detection SHALL NOT be used to build the list of landed tickets itself: the delivery records remain the only source for that list. A release whose commits cannot be read (for example because the release directory's clone no longer exists) SHALL be treated as having nothing to report, not as an error.

#### Scenario: A ticket's work landed without a delivery record

- **WHEN** a completed upgrade's release window contains a commit named after a ticket that the delivery records do not account for
- **THEN** the posted message and the conductor's wake both say that a change is in the release without a delivery record, and the wake names it when its identifier can be read from the commit subject

#### Scenario: Every ticket-referencing commit is accounted for

- **WHEN** every ticket-referencing commit in a completed upgrade's release window matches a ticket already listed among the landed tickets
- **THEN** the message and the wake read exactly as they do when no such check exists, with nothing added

#### Scenario: The release history cannot be read

- **WHEN** the release directory a completed upgrade targets no longer has a readable git history
- **THEN** the announcement reports nothing about undelivered commits, rather than failing or misreporting a count
