## ADDED Requirements

### Requirement: The not-reviewed list is current whichever wake carries the digest

A digest wake SHALL have its not-reviewed list re-checked at delivery whether it is delivered as its own wake or was coalesced into another queued wake of the weaver, including a wake from a worker report, a decision answer or a human message. A card carrying a weaver review mark SHALL NOT be named, however short the gap between the mark and the delivery.

#### Scenario: Digest coalesced into a non-system wake

- **WHEN** a digest naming an unreviewed card is coalesced into a queued wake that is not system-sourced, and the weaver marks that card reviewed before delivery
- **THEN** the delivered digest entry does not name the card and carries no not-reviewed note

#### Scenario: Unmarked card in a coalesced digest

- **WHEN** a digest coalesced into a non-system wake names a card that is still unreviewed at delivery
- **THEN** the card is still named
