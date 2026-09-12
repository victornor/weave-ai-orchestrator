# brand-mark Specification

## Purpose
Defines the product's brand mark as a reusable piece of the web app's chrome: the artwork it uses,
the ratio it must keep, where its colour comes from, how it is named to assistive technology, and
the places the app shows it so the product identifies itself on every surface a human first meets.

## Requirements

### Requirement: The mark appears wherever the app identifies itself

The web app SHALL show the Weave brand mark on three surfaces: at the top of the desktop sidebar
rail, above the global navigation section; on the login screen; and on the onboarding screen. On
the sidebar the mark SHALL be an addition above the existing global navigation, not a replacement
for any existing entry. On the login and onboarding screens the mark SHALL take the place of the
placeholder accent tile that currently precedes the wordmark.

The mark SHALL be a self-contained part of the app: it SHALL NOT require a network request, a new
build dependency, or an asset served separately from the app bundle.

#### Scenario: The sidebar shows the mark

- **WHEN** the desktop sidebar is rendered
- **THEN** the mark is shown at the top of the rail, above the global navigation links

#### Scenario: The login screen shows the mark

- **WHEN** the login screen is rendered
- **THEN** the mark is shown next to the wordmark

#### Scenario: The onboarding screen shows the mark

- **WHEN** the onboarding screen is rendered
- **THEN** the mark is shown next to the wordmark

#### Scenario: The mark costs no request

- **WHEN** any of the three surfaces is rendered
- **THEN** no network request is made to fetch the mark and no new dependency is used to draw it

### Requirement: The mark keeps its true ratio and is never distorted, cropped or letterboxed

The mark's artwork SHALL be 4.5:1 (approximately 4.497:1). Wherever it is shown, its rendered
proportions SHALL match that ratio: the mark SHALL be given a height and allowed to derive its
width, or both dimensions SHALL be set from the ratio. The mark SHALL NOT be stretched or squashed
to a width chosen independently of its height.

The thread entering from the left edge and leaving at the right edge SHALL remain part of the
rendered mark. The mark SHALL NOT be cropped to the knot alone, and it SHALL NOT be fitted into a
square by letterboxing or by any other means. Where a slot is square, the mark is the wrong asset
for that slot and SHALL NOT be used there.

#### Scenario: A height is given

- **WHEN** the mark is rendered at a chosen height
- **THEN** its rendered width equals that height times the artwork's ratio, within rounding

#### Scenario: The threads are intact

- **WHEN** the mark is rendered on any of its surfaces
- **THEN** both the entering and leaving thread are visible, not cropped to the central knot

#### Scenario: No square slot

- **WHEN** the mark is placed next to or inside a square slot
- **THEN** it keeps its own ratio rather than being squashed or letterboxed to fill the square

### Requirement: The mark takes its colour from CSS

The mark's colour SHALL come from the surrounding CSS text colour rather than a hard-coded colour,
so it is legible against the app background in whichever theme is active. The mark SHALL NOT carry
its own literal colour value.

#### Scenario: Dark theme

- **WHEN** the app is rendered in its dark theme
- **THEN** the mark is drawn in the surrounding text colour and is legible against the dark background

#### Scenario: Light theme

- **WHEN** the app is rendered in its light theme
- **THEN** the mark is drawn in the surrounding text colour and is legible against the light background

### Requirement: The mark's accessible name follows its context

Where an adjacent wordmark already names the product, the mark SHALL be hidden from assistive
technology, so a screen reader is not given the same word twice. Where the mark stands alone and
nothing nearby names the product, it SHALL be exposed as an image with the accessible name "Weave".
The mark SHALL NOT be exposed as an unlabelled image or as decorative when it is the only thing
naming the product.

#### Scenario: A wordmark sits beside it

- **WHEN** the mark is rendered next to a wordmark that names the product
- **THEN** the mark is hidden from assistive technology and the wordmark is the accessible name

#### Scenario: The mark stands alone

- **WHEN** the mark is rendered with no adjacent wordmark naming the product
- **THEN** it is exposed as an image with the accessible name "Weave"

### Requirement: The launcher tiles are unchanged

The square launcher icons (`icon.svg`, `icon-maskable.svg`) and the web app manifest SHALL remain
as they are. The 4.5:1 mark SHALL NOT replace them.

#### Scenario: The launcher icon still renders

- **WHEN** the app's installed icon is requested
- **THEN** the square launcher tile is served unchanged
