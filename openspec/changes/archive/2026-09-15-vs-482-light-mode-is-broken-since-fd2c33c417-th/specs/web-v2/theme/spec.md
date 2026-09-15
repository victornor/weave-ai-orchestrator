## ADDED Requirements

### Requirement: The V2 root paints its own ground and ink

The V2 root element (`.v2-root`) SHALL paint its own ground and inherited ink from the active theme
tokens — `--bg-0` for the ground and `--text-1` for the ink — and SHALL carry the app's base
typography on that same element. The app's theme SHALL therefore be self-contained on its own root:
a theme declared on `<html>` or `body` SHALL NOT decide what the app paints, and the tokens SHALL
resolve whether `data-theme` is carried by `<html>`, by `.v2-root`, or by both.

#### Scenario: Light theme under a dark document root

- **WHEN** `<html>` carries `data-theme="dark"` and `.v2-root` carries `data-theme="light"`
- **THEN** `.v2-root`'s ground resolves to the light `--bg-0` and no region inside it paints the dark
  ground

#### Scenario: The rail brand mark in light mode

- **WHEN** the rail's brand mark renders in the light theme with no explicit ink class of its own
- **THEN** it inherits the light `--text-1` (dark ink), not the document root's theme ink

#### Scenario: An unscrolled region keeps the app ground

- **WHEN** a V2 screen renders a body region that sets no background of its own
- **THEN** that region shows `.v2-root`'s painted ground rather than the document body's

#### Scenario: Runtime switching repaints both directions

- **WHEN** the theme switch flips `.v2-root`'s `data-theme` between dark and light with no reload
- **THEN** the painted ground and inherited ink follow the new theme in that same paint

#### Scenario: A mirrored token container paints nothing of its own

- **WHEN** a container mirrors `.v2-root`'s class only to inherit the theme tokens
- **THEN** it keeps its own transparent background and introduces no ground of its own