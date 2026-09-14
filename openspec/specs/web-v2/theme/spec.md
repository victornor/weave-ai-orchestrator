# web-v2/theme Specification

## Purpose
The Mono palette and the shape/density primitives the V2 app is built from: one greyscale token set
declared once with separate dark and light values, hue reserved for work that is live, a persisted
in-app theme switch, and the angular, unfussy geometry the redesign specifies.

## Requirements

### Requirement: Mono is the only palette, declared once for dark and light

The V2 app SHALL express every colour through one set of named tokens declared once, with a dark and
a light value for each name. The token names SHALL be shared by both themes, so switching theme
changes values and never class names or component markup.

In the dark theme the surfaces SHALL be near-black: ground `#050506`, cards `#0b0b0d`, raised
`#101012`, with input, hairline and raised-hover values drawn down to match. In the light theme the
surfaces SHALL be the authored light values (ground `#f7f8f9`, cards `#ffffff`, raised `#f2f3f5`),
not an inversion of the dark set.

#### Scenario: The dark ground

- **WHEN** the V2 app renders in dark theme
- **THEN** the app ground resolves to `#050506`, cards to `#0b0b0d` and raised surfaces to `#101012`

#### Scenario: The light ground

- **WHEN** the V2 app renders in light theme
- **THEN** the app ground resolves to `#f7f8f9`, cards to `#ffffff` and raised surfaces to `#f2f3f5`

#### Scenario: One declaration, two themes

- **WHEN** a component uses a colour token
- **THEN** the same token name resolves in both themes without a theme-specific class or markup
  branch

### Requirement: Hue is spent only where work is live

The V2 chrome SHALL be greyscale. Colour SHALL appear only on live state — `working` amber,
`needs-you` indigo and `blocked` red — while `done`, `merging` and `idle` SHALL stay greyscale. The
accent SHALL appear on primary actions and focus.

#### Scenario: A working state is amber

- **WHEN** a V2 surface shows a worker that is working
- **THEN** the state hue is the working amber and the surrounding chrome stays greyscale

#### Scenario: A done state is greyscale

- **WHEN** a V2 surface shows a ticket that is done
- **THEN** the state reads as greyscale, not as a coloured success hue

### Requirement: Project colour is an identity, reused across versions

A project SHALL carry one stable colour wherever the V2 app names it — rail, project tag, ticket
card, message metadata and settings lists. The V2 project palette SHALL be the same hand-picked,
deterministic palette V1 assigns a project, so a project's hue is identical in both versions, and
SHALL stay distinct from the status hues and the accent.

#### Scenario: The same project in both versions

- **WHEN** a project is named in V1 and in V2
- **THEN** its identifying colour is the same in both

#### Scenario: A project name in the rail

- **WHEN** the V2 rail lists a workspace's projects
- **THEN** each project's name is rendered in that project's colour as text, with no coloured dot
  or square beside it

### Requirement: Contrast rules are built into the token set

`--text-4` SHALL resolve to the same value as `--text-3` in both themes, so the V2 app has one fewer
distinguishable ink rather than an ink that fails contrast. No V2 container SHALL be dimmed with
`opacity` to de-emphasise it; a recessed background with a stronger ink SHALL be used instead. Prose
links SHALL be underlined and SHALL take `--accent-link`, never a hardcoded hex.

#### Scenario: The fourth ink collapses

- **WHEN** `--text-4` and `--text-3` are read in either V2 theme
- **THEN** they resolve to the same value

#### Scenario: A de-emphasised container

- **WHEN** a V2 surface needs to read as recessed
- **THEN** it uses a recessed background and a stronger ink rather than a reduced opacity

#### Scenario: A prose link

- **WHEN** a link appears in V2 prose
- **THEN** it is underlined and coloured from `--accent-link`

### Requirement: The light/dark switch lives in the sidebar footer and persists

The V2 sidebar footer SHALL carry an in-app light/dark switch beside the account line, and the
collapsed rail SHALL carry a single toggle button. Activating it SHALL change the V2 theme without a
reload and SHALL remember the choice on the device, restoring it on the next visit. The mockup's
harness switch above the frame SHALL NOT ship.

#### Scenario: Switching theme

- **WHEN** the user activates the theme switch
- **THEN** the V2 app repaints in the other theme without a reload

#### Scenario: The choice survives a reload

- **WHEN** the user selects a theme and reloads the app
- **THEN** the V2 app starts in the selected theme

#### Scenario: The collapsed rail still switches

- **WHEN** the rail is collapsed to its 48px form
- **THEN** a single theme toggle button is available

### Requirement: Shape and density primitives are built once and shared

The V2 app SHALL build its shape and density rules as shared primitives rather than per-screen
styles: cards and controls use 4–6px corners and no pill-shaped control exists; one bordered tag
recipe (a 1px border tinted from the tag's own colour, a 4px radius and 10px monospace type) is used
for every kind, tier, state, project and inline ticket reference; the expanded sidebar is 194px
wide; and the generic screen header and Chat's own status bar are both 38px tall so they match.

#### Scenario: A tag

- **WHEN** the V2 app renders a kind, tier, state, project or inline ticket reference tag
- **THEN** it uses the one bordered recipe and not a pill or a borderless chip

#### Scenario: Corners are angular

- **WHEN** a V2 card or control is rendered
- **THEN** its corner radius is 4–6px and no pill shape is used

#### Scenario: The header bars match

- **WHEN** a V2 screen header and Chat's own status bar are both rendered
- **THEN** both are 38px tall

#### Scenario: The sidebar width

- **WHEN** the V2 sidebar is expanded
- **THEN** it is 194px wide

### Requirement: A colour utility resolves against the scoped V2 theme

Every V2 colour utility class built from a Mono token (`text-text-1`, `text-text-strong`, and the
rest of the `text-*`/`bg-*`/`border-*` families) SHALL resolve its value against the theme declared
on its nearest `.v2-root` ancestor at the element that uses it, not against a value computed once at
the document root. Switching V2's `data-theme` SHALL therefore repaint every element styled through a
token utility in both directions, with no per-component branch and no reload.

#### Scenario: A primary title in the dark theme

- **WHEN** a V2 screen renders a primary title through `text-text-1` or `text-text-strong` while the
  scoped theme is dark
- **THEN** the title takes the dark theme's bright ink and is legible on the dark ground

#### Scenario: The same title in the light theme

- **WHEN** the same element renders while the scoped theme is light
- **THEN** the title takes the light theme's dark ink and is legible on the light ground

#### Scenario: A V1 element is untouched

- **WHEN** a V1 element uses the same utility class outside any `.v2-root`
- **THEN** it keeps resolving against V1's own theme
