## MODIFIED Requirements

### Requirement: Only a reviewed, human answer promotes

An approving answer to a `promotion_approval` SHALL be accepted only from a human, only after the weaver
has marked the card looked at the current landing and default heads, and never through YOLO, auto-merge or
any system grant. A head that moved after the review mark SHALL hold the approval until it is reviewed
again. While it is held this way the weaver SHALL be woken to review the new head without the human acting,
and the card SHALL state in plain words why approval is refused; the statement SHALL clear itself once a
review lands at the current head.

#### Scenario: YOLO does not promote
- **WHEN** a workspace has YOLO on and a promotion card is open
- **THEN** the card stays open until a human answers it

#### Scenario: A moved head holds the approval
- **WHEN** landing gains a commit after the weaver marked the card looked
- **THEN** approving is held until the weaver reviews the new head

#### Scenario: The stale review is explained on the card
- **WHEN** the landing branch moves after the weaver's review and a human taps Approve
- **THEN** no promotion occurs and the card shows that landing moved since the last review and the weaver
  is re-checking it

#### Scenario: Re-review at the new head lifts the hold
- **WHEN** the weaver marks the card looked at the new landing head
- **THEN** the stale-review statement is gone and a human approving the card promotes the new head

### Requirement: Promoted tickets read in production and never reopen

When a promotion succeeds, every ticket whose landed work is contained in the promoted range SHALL show
the delivery state "in production". A promotion SHALL record the commit the forge reports for the merge
(a squash rewrites the ticket commits, so ancestry alone is not proof) and SHALL stamp the included
tickets as promoted; a ticket so stamped SHALL NOT read as unpromoted merely because its landed commit is
not an ancestor of the default branch. No ticket's status SHALL change and no ticket SHALL reopen, and a
later card SHALL NOT list content already promoted. A ticket SHALL be listed as waiting only when its
landed content is absent from the default branch, and the surface's `ahead` figure SHALL count only
commits whose content the default branch lacks — never the raw number of commits the landing branch
carries ahead, which a squash promotion leaves permanently behind.

#### Scenario: Included tickets flip

- **WHEN** a promotion succeeds
- **THEN** each ticket in the range reads "in production" and stays done

#### Scenario: Later landing is not in production

- **WHEN** a ticket lands on `edge` after a promotion
- **THEN** it reads "on edge"

#### Scenario: A squash promotion does not inflate the count

- **WHEN** landing's earlier commits were squash-promoted to the default branch and only newer commits
  remain unshipped
- **THEN** `ahead` counts only the newer commits and the shipped tickets are not listed as waiting

#### Scenario: A ticket shipped without a recorded promotion is not re-listed

- **WHEN** a ticket's landed content is already on the default branch although its landed commit is not an
  ancestor of it
- **THEN** the ticket is not listed as waiting on the next card

## ADDED Requirements

### Requirement: An open promotion card tracks the current landing head

While a `promotion_approval` is open, the daemon SHALL recompute the card in place when the landing branch
head moves, so its context and target show the current commits, tickets, changed-file summary and
ahead/behind, and its offered options match what the current content allows. The recomputation SHALL be
driven from an existing trigger — the merge that lands on the landing branch or the supervisor's
promotion cadence — and SHALL NOT add a polling loop of its own. The same recomputation SHALL wake the
workspace weaver to review the card at the new head; a `concerns` mark SHALL continue to hold the card
until the weaver revisits it.

#### Scenario: The card is refreshed when the landing head moves

- **WHEN** a commit lands on the landing branch while a promotion card is open
- **THEN** the card's context and target are recomputed at the new head on an existing trigger, with no
  second card raised

#### Scenario: The weaver is woken to re-review the new head

- **WHEN** a promotion card is refreshed because its landing head moved
- **THEN** the workspace weaver receives one wake naming the card and the new head so it can mark a fresh
  review there

#### Scenario: A concerns mark keeps holding

- **WHEN** the card carries a `concerns` mark and the landing head moves
- **THEN** the card is refreshed but the concerns mark still holds approval

#### Scenario: Shipped content is dropped from the refreshed card

- **WHEN** the landing branch's content is already on the default branch (a squash promotion) and only
  newer commits remain
- **THEN** the refreshed card lists only the newer tickets and commits and reports only the missing content