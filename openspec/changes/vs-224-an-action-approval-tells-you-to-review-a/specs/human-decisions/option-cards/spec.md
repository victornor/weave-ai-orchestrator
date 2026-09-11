## ADDED Requirements

### Requirement: A decision that targets a document shows that document on its card

A decision whose target carries a document reference — a document id and the revision being decided — SHALL show that document's content on its card, whatever kind the decision is. The rendering SHALL be driven by the document reference on the decision, not by the decision's kind, so a decision of any kind carrying the same reference renders the same way. A decision with no document reference SHALL render exactly as it does without this capability, and no document region SHALL appear on its card.

The card SHALL show which revision of the document the human is being asked to decide on. When the document has moved past that revision, the card SHALL NOT present the older content as current: it SHALL say the document has been revised since the decision was raised, and label any shown content with the superseded revision it actually is. When the revision the decision names no longer exists, the card SHALL say so rather than showing nothing in its place or passing off other content as it.

The complete document SHALL be reachable from the card without leaving it: the content renders on the card, and a control on the card reveals or collapses it, so nothing the human needs in order to judge the decision lives one tap away.

A document SHALL NOT render twice on one card. Where a decision's document is already rendered by a purpose-built slot on that card — the plan-approval card's plan slot is the one today — the document SHALL render through that slot and SHALL NOT additionally render through the general preview. The suppression SHALL follow the slot the card is already rendering, not a new check on the decision's kind, so the next purpose-built slot suppresses the general preview the same way without touching this code path again.

#### Scenario: an action-approval card shows the action document

- **WHEN** an open `action_approval` carries a document reference and the document is at the revision it names
- **THEN** the card shows the document's content, with the revision it names
- **AND** a control on the card reaches the complete document

#### Scenario: another kind carrying the same reference renders the document too

- **WHEN** a decision of a kind other than `action_approval` carries the same document-reference shape
- **THEN** its card renders the document the same way, with no kind-specific check

#### Scenario: a plan approval renders its plan exactly once

- **WHEN** a `plan_approval` carries a document reference for the plan digest and its card also renders the plan slot
- **THEN** the plan document appears on the card exactly once, through the plan slot
- **AND** the general preview renders nothing for that card

#### Scenario: a decision with no document reference is unchanged

- **WHEN** a decision carries no document reference in its target
- **THEN** its card renders exactly as before, with no document region and no fetch of one

#### Scenario: a superseded revision is never shown as current

- **WHEN** a card's document reference names revision 2 and the document has since moved to revision 3
- **THEN** the card says the document was revised since the decision was raised
- **AND** any content it shows for revision 2 is labelled as the superseded revision, never as current

#### Scenario: a revision that no longer exists

- **WHEN** a card's document reference names a revision the document does not have
- **THEN** the card says that revision could not be found, naming what it asked for, and shows no other content in its place

#### Scenario: a missing document is said, not blank

- **WHEN** the document a card's reference names cannot be read at all
- **THEN** the card says the document could not be found rather than rendering an empty region
