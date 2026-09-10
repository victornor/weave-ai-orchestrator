## ADDED Requirements

### Requirement: The Models page states inherit-or-override explicitly for each overlay row

For each of the conductor overlay row and the workers overlay row, the daemon Models page SHALL
present an explicit choice between inheriting the workspace setting and overriding it, rather than
inferring which is in force from which buttons happen to be shown. The current choice SHALL be
readable without depending on whether the operator has changed anything else on the row.

While a row is inheriting, its runtime and model controls SHALL show the value that is currently
inherited and SHALL NOT accept a change: opening or changing them SHALL have no effect on the
overlay. Interacting with the explicit inherit/override choice itself is the only way to change
which state a row is in.

#### Scenario: Each row states its own state

- **WHEN** the daemon Models page is opened
- **THEN** the conductor row and the workers row each show, in a form that does not require
  comparing which buttons are present, whether they are inheriting or overriding

#### Scenario: Opening or changing an inheriting row's fields does nothing

- **WHEN** a row is inheriting and its runtime or model control is opened or changed
- **THEN** no overlay is created and no write is made to the daemon

#### Scenario: Choosing to override is the deliberate act that creates the overlay

- **WHEN** the operator chooses "override" for a row that was inheriting
- **THEN** an overlay is created for that row, seeded from the value it was inheriting

#### Scenario: Choosing to inherit is a normal option, not a special-cased button

- **WHEN** a row is overridden
- **THEN** returning it to inherited is available as one of the row's normal choices, not only
  through a button that appears solely because an overlay exists

### Requirement: An inheriting row shows the value it inherits

While a row is inheriting, the Models page SHALL show the effective value the row currently
resolves to — the runtime and the model — rather than leaving the row blank or showing a value
unrelated to what actually governs turns.

Because the overlay is shared by every workspace on the daemon while each workspace may hold a
different setting, the value shown SHALL be stated as belonging to the workspace currently being
viewed, not asserted as the value every workspace resolves to.

#### Scenario: The inherited value is shown, not blank

- **WHEN** a row is inheriting
- **THEN** the runtime and the model it currently resolves to for the workspace being viewed are
  visible on the page

#### Scenario: The shown value is not claimed to be universal

- **WHEN** a row is inheriting and two workspaces on the same daemon hold different settings for
  that control
- **THEN** the page does not present the shown value as the one every workspace uses
