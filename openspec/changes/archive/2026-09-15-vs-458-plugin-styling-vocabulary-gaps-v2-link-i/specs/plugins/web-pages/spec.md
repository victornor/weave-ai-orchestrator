## ADDED Requirements

### Requirement: The vocabulary includes a link role and a table action-cell role

`WEAVE_PLUGIN_CLASS` SHALL include a `link` role, and the table recipe's cell roles SHALL include
an `actions` role for inline per-row controls, both published by `@weave-ai/plugin-sdk` and carrying
no colour, spacing, radius or font value. A plugin SHALL name the action role through the SDK's
exported cell-role constant rather than spelling its attribute value itself.

#### Scenario: The link role is published

- **WHEN** `WEAVE_PLUGIN_CLASS` is read from `@weave-ai/plugin-sdk`
- **THEN** it has a `link` member naming a `v2-*` class, and the object still contains no colour,
  spacing, radius or font value

#### Scenario: The action-cell role is published

- **WHEN** the SDK's table cell-role constant is read
- **THEN** it names an `actions` role, alongside the existing primary and secondary roles

#### Scenario: A plugin needs no CSS for a link or a row action

- **WHEN** a plugin's page markup uses the `link` class for an anchor, or a `actions`-role cell
  holding `.v2-button`s, and includes the standard client bootstrap script
- **THEN** the page renders styled, without the plugin defining or inlining any CSS rule itself

### Requirement: The generated stylesheet styles links and the table's action cell

The daemon-generated plugin stylesheet SHALL style prose links — a bare `<a>` and the vocabulary's
`link` class — and the table's `actions` cell role, in both dark and light, derived from
`packages/ui/src/v2/v2.css`'s own current rules so a V2 restyle reaches an already-installed plugin
with no plugin change. A plugin page has no `.v2-root` wrapper, so the emitted link rule SHALL NOT
depend on one.

#### Scenario: The generated stylesheet styles a bare link and the link class

- **WHEN** the generated plugin stylesheet is inspected
- **THEN** it contains a rule that styles a bare `<a>` and one that styles `a.v2-link`, both using
  the theme's link token so they follow dark and light

#### Scenario: The generated stylesheet styles the action cell

- **WHEN** the generated plugin stylesheet is inspected
- **THEN** it contains a rule for the table's `actions` cell role

#### Scenario: Every vocabulary item still has a rule

- **WHEN** the generated plugin stylesheet is inspected
- **THEN** every value in `WEAVE_PLUGIN_CLASS` — including `link` — has at least one matching rule,
  exactly as the other roles already do

#### Scenario: The link rule carries no visual literal

- **WHEN** the emitted link rule is inspected
- **THEN** its colour comes from a token the generated stylesheet itself defines, not a literal
  colour value