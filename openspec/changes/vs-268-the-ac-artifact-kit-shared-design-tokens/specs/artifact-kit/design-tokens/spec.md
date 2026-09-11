## Purpose

A small, prebuilt, dependency-free CSS kit so a self-contained HTML artifact looks like
AgentConductor rather than a generic template, with no build step and no risk of drifting from the
web app's own visual language.

## ADDED Requirements

### Requirement: The kit ships AC's design tokens
The kit SHALL define, as plain CSS custom properties requiring no build step to consume, AC's
dark-default token set and its `[data-theme='light']` override set, covering surface, text, accent,
the nine status colors, and the space, radius, font-family and font-size scales.

#### Scenario: Reading the raw kit
- **WHEN** an agent or the web app reads the kit's CSS text
- **THEN** it finds a dark-default token block and a `[data-theme='light']` block, each defining the
  same named custom properties with theme-appropriate values, with no `@import`, no external `url()`,
  and no compilation step required before a browser can use them.

### Requirement: Kit tokens never drift from the app's tokens
The token names and values in the kit's dark and light sets SHALL match the corresponding token
definitions in the web app's own CSS token source exactly. This equivalence SHALL be enforced by an
automated check that fails whenever either source changes without the other.

#### Scenario: A token changes in one source only
- **WHEN** a token's value, or its presence, in the app's CSS token source no longer matches the
  kit's copy of that token
- **THEN** the automated drift check fails, identifying the mismatched token.

#### Scenario: Both sources agree
- **WHEN** the kit and the app's CSS token source define the same token names with the same values
- **THEN** the automated drift check passes.

### Requirement: The kit is self-contained and offline-renderable
The kit SHALL contain no JavaScript, require no compiler or build step at view time, and reference no
resource outside a `data:` URI. An HTML document that uses only the kit's CSS SHALL render with
correct AC styling, in both the dark and light theme, when opened directly from local disk with no
network access.

#### Scenario: Opened from disk with no network
- **WHEN** a self-contained HTML file that links or inlines only the kit's CSS is opened directly
  from the filesystem with network access disabled
- **THEN** it renders fully styled, matching AC's dark theme by default and its light theme under
  `[data-theme='light']`, with no failed resource loads and no script execution required.
