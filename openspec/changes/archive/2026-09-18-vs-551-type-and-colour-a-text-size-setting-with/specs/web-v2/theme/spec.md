## ADDED Requirements

### Requirement: The type scale is one family scaled from a single multiplier

The app's type scale SHALL derive every named size (`display`, `title`, `head`, `body`, `ui`, `meta`,
`micro`, `nano`) from one family scaled by a single multiplier, so that one value resizes the whole
scale. At the default multiplier every size SHALL be the value it has today, so an install that never
changes the preference is unchanged. A surface that renders type SHALL take its sizes from that
scaled family rather than a second, independently sized mechanism.

#### Scenario: The default multiplier reproduces today's sizes

- **WHEN** the scale multiplier is at its default
- **THEN** every named size resolves to the value it had before the preference existed

#### Scenario: One multiplier resizes every size

- **WHEN** the multiplier changes
- **THEN** every named size in the family scales by that multiplier together, and the weaver chat's
  body text scales with the rest of the app rather than from a mechanism of its own

### Requirement: A semantic colour resolves to the same hue in both themes

Every semantic colour token — the status set, the approve control, the reviewed-clean ink, the diff
pair and the project palette — SHALL resolve to the same hue in the dark and light themes, varying
only in lightness and saturation as each ground needs for contrast. A semantic token that resolves to
a different hue per theme SHALL be corrected to one hue at two lightnesses; it SHALL NOT be left as
two hues because a hue that reads on a dark ground fails on a light one.

The code syntax palette (`--syntax-*`) is a per-theme code colouring, not a semantic colour, and is
exempt.

#### Scenario: The approve control across themes

- **WHEN** the available Approve control is read in the dark theme and in the light theme
- **THEN** it is the same inverse high-contrast action in both — a dark fill with white ink in light
  and a near-white fill with dark ink in dark — with no hue in either, rather than a coloured fill in
  one theme and a near-white fill in the other

#### Scenario: The reviewed-clean ink across themes

- **WHEN** the clean-review ink is read in the dark theme and in the light theme
- **THEN** it is the same green hue in both, at whatever lightness each ground needs, rather than a
  teal in one theme and a green in the other

#### Scenario: A status hue is stable across themes

- **WHEN** a working, needs-you, blocked, done, merging or failed state is read in either theme
- **THEN** its hue matches its counterpart in the other theme

#### Scenario: The syntax palette is exempt

- **WHEN** a `--syntax-*` token differs between themes
- **THEN** that is allowed, because it colours code rather than naming a state

#### Scenario: Contrast remains legible

- **WHEN** a semantic ink resolves against the ground it is drawn on in either theme
- **THEN** it still meets the contrast the token set requires; same-hue correction SHALL NOT lower an
  ink to an illegible contrast

## MODIFIED Requirements

### Requirement: Hue is spent only where work is live

The V2 chrome SHALL be greyscale. Colour SHALL appear only on live state — `working` amber,
`needs-you` indigo and `blocked` red — while `done`, `merging` and `idle` SHALL stay greyscale. The
accent SHALL appear on primary actions and focus. The affirmative action (Approve) SHALL be a neutral
fill rather than a hue, so it is not the most saturated thing on a card and reads as the ordinary
action it is.

#### Scenario: A working state is amber

- **WHEN** a V2 surface shows a worker that is working
- **THEN** the state hue is the working amber and the surrounding chrome stays greyscale

#### Scenario: A done state is greyscale

- **WHEN** a V2 surface shows a ticket that is done
- **THEN** the state reads as greyscale, not as a coloured success hue

#### Scenario: The approve action is neutral

- **WHEN** an available Approve control is rendered
- **THEN** it is a neutral fill, and the only hue on the card is a live state such as the blocked ink
