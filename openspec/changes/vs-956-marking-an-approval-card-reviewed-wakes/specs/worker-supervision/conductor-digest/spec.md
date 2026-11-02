## ADDED Requirements

### Requirement: The digest's not-reviewed list is current when delivered

A digest wake that names approval cards as not yet reviewed SHALL, when it is delivered to the weaver, name only cards that are still open, human-owned and unreviewed at that moment. A card the weaver marked reviewed between the digest being queued and delivered, with or without a waiting-on note, SHALL NOT be named. A card still unreviewed SHALL still be named.

#### Scenario: Card marked while the digest waits for the weaver's turn to end

- **WHEN** a digest naming an unreviewed card is queued while the weaver is mid-turn, and the weaver marks that card reviewed before the digest is delivered
- **THEN** the delivered digest does not name that card and its reason carries no not-reviewed note

#### Scenario: Card marked with a waiting-on note

- **WHEN** the weaver marks a card reviewed with a waiting-on note after the digest was queued
- **THEN** the delivered digest does not name that card

#### Scenario: A card left unmarked is still reported

- **WHEN** a digest names two unreviewed cards and the weaver marks only one before delivery
- **THEN** the delivered digest names the other card, with the count and its age recomputed at delivery
