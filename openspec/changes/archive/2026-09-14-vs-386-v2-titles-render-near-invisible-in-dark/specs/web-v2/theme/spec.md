## ADDED Requirements

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
