# project-overview/reserved-sections Specification

## Purpose
Describes the two sections the project overview holds open for the commit graph and the pull-request
viewer before either exists — that they are present, named and honest about being empty, and that
every section of the page is rendered against one contract, so a later change supplies a section's
content without reshaping the page.

## Requirements

### Requirement: Every section of the overview is rendered against one contract

Each section of the project overview SHALL be presented the same way: a stable name, a heading, an
address that can be linked to, and on a phone a control that collapses and expands it. A section's
content SHALL be supplied separately from that presentation, and SHALL be given the project it is
about and the workspace it belongs to.

Adding a section's content SHALL NOT require the page's layout, its ordering or any other section to
change.

#### Scenario: A section is addressable

- **WHEN** the overview is opened at the address of one of its sections
- **THEN** that section is the one brought into view

#### Scenario: Sections keep their order

- **WHEN** a section that had no content is given content
- **THEN** the page's other sections keep their order and their behaviour

### Requirement: A section whose content grows with data caps its height and scrolls within itself

A section of the project overview whose body has no built-in limit on how much it renders SHALL cap
its height at a value expressed relative to the browser's viewport, and SHALL scroll its own content
past that cap rather than growing the page. The cap SHALL be a maximum only: a section whose content
is shorter than the cap SHALL render at its natural height and SHALL NOT be stretched or padded out
to the cap.

Reaching the top or bottom of a capped section's scrolled content SHALL NOT prevent the page itself
from continuing to scroll on the same wheel or swipe gesture.

A capped section with more content than fits SHALL make that visually apparent, using whatever
affordance the rest of the app already uses for a scrollable region rather than a new one invented
for this.

A section whose body already limits how much it renders on its own, independent of how much
underlying data exists, is not subject to this cap.

The collapse-and-expand disclosure every section has SHALL be unaffected by whether the section is
capped: a collapsed section SHALL show nothing, capped or not, and expanding it SHALL restore it to
its capped or natural height as before. The page's desktop column layout SHALL be unaffected by
capping a section.

#### Scenario: A section under its cap renders at its natural height

- **WHEN** a capped section's content is shorter than its height cap
- **THEN** the section renders at the height its content needs, with no internal scrollbar

#### Scenario: A section over its cap scrolls internally

- **WHEN** a capped section's content exceeds its height cap
- **THEN** the section stops growing at the cap and its content scrolls within it

#### Scenario: Scrolling past a capped section's content reaches the page

- **WHEN** a capped section is scrolled to the end of its content and the same gesture continues
- **THEN** the page scrolls, rather than the gesture doing nothing further

#### Scenario: A collapsed section is unaffected

- **WHEN** a capped section is collapsed
- **THEN** it shows nothing, the same as an uncapped section collapsed, and the cap plays no part

#### Scenario: A section with a built-in limit is not capped

- **WHEN** a section's body already limits how many entries it renders regardless of how much data
  exists
- **THEN** that section is not given a height cap or a scrollbar it does not need
