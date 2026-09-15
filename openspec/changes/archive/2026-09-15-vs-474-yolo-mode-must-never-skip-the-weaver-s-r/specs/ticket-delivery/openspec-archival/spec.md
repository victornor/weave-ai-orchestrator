## MODIFIED Requirements

### Requirement: An archive merge approval lands only on approval

With YOLO mode off for the ticket's project, the daemon SHALL NOT merge an archive-backfill pull
request until its merge card has been answered `approve`. A card answered `changes` SHALL record the
human's feedback on the ticket and SHALL NOT merge the pull request. Under YOLO mode the daemon SHALL
grant the approval itself and land the pull request, on the same terms it grants a ticket's merge
approval — which, since this change, means after the weaver has marked the card **looked at**, not at
the moment the card is raised. While the card is **not looked at yet** or **looked at, with
concerns**, the daemon SHALL NOT answer it and SHALL NOT land the pull request. The grant SHALL also
require the head recorded at the `looked` mark to equal the archive pull request's current head: while
the recorded head is absent or differs from the pull request's head — because the archive branch was
rebuilt after the mark — the card SHALL be treated as unreviewed and the pull request SHALL NOT be
merged, until the weaver marks the card looked at against the new head. The review records the archive
pull request's own head, not the finished ticket's original pull request. The ticket's `auto_merge`
flag SHALL have no effect on an archive card, because the ticket it belongs to is already finished and
carries no merge of its own.

#### Scenario: YOLO off, no landing without approval

- **WHEN** an archive pull request is open and its card has not been answered
- **THEN** the pull request is not merged, whatever the project's other policies say

#### Scenario: YOLO on holds the archive until review

- **WHEN** the project runs under YOLO mode and an archive pull request's card is raised
- **THEN** the card is open and **not looked at yet**, the daemon does not answer it, and the pull request is not merged

#### Scenario: YOLO on lands the archive without a human

- **WHEN** the project runs under YOLO mode, an archive pull request's card is raised, and the weaver marks it **looked at** with its note
- **THEN** the daemon answers the card itself without the human and lands the pull request

#### Scenario: YOLO holds the archive on a concern

- **WHEN** the project runs under YOLO mode and the weaver marks an open archive merge card **looked at, with concerns**
- **THEN** the daemon does not answer the card and the pull request is not merged

#### Scenario: YOLO holds the archive when its head moved after the mark

- **WHEN** the weaver marks an archive merge card looked at head A and the archive pull request's head later becomes B
- **THEN** the daemon does not grant the card and the pull request is not merged

#### Scenario: YOLO lands the archive after a fresh look at the new head

- **WHEN** the card held at head B is marked looked at again with head B recorded
- **THEN** the daemon grants the card and lands the pull request

#### Scenario: Changes records feedback and does not merge

- **WHEN** the human answers an archive merge card `changes` with a reason
- **THEN** the reason is recorded on the ticket and the pull request is left open and unmerged
