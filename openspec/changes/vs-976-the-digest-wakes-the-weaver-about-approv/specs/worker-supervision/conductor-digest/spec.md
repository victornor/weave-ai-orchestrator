## ADDED Requirements

### Requirement: The not-reviewed list is current whichever wake carries the digest

A digest wake SHALL have its not-reviewed list re-checked at delivery whether it is delivered as its own wake or was coalesced into another queued wake of the weaver, including a wake from a worker report, a decision answer or a human message. A card carrying a weaver review mark SHALL NOT be named, however short the gap between the mark and the delivery.

#### Scenario: Digest coalesced into a non-system wake

- **WHEN** a digest naming an unreviewed card is coalesced into a queued wake that is not system-sourced, and the weaver marks that card reviewed before delivery
- **THEN** the delivered digest entry does not name the card and carries no not-reviewed note

#### Scenario: Unmarked card in a coalesced digest

- **WHEN** a digest coalesced into a non-system wake names a card that is still unreviewed at delivery
- **THEN** the card is still named

### Requirement: The not-reviewed list is re-checked when the turn prompt is built

The not-reviewed list SHALL also be re-checked after the wake is claimed and before the weaver's turn prompt is rendered, so a review mark recorded between claim and render does not appear as unreviewed.

#### Scenario: Card marked after the wake was claimed

- **WHEN** a digest wake naming an unreviewed card has been claimed and the weaver's mark on that card is recorded before the prompt is built
- **THEN** the prompt's digest reason does not name the card
