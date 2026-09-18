## ADDED Requirements

### Requirement: The device section offers a text-size control with a live preview

The device-scoped *This device* settings section SHALL offer a text-size control with a bounded set of
steps — Smallest, Smaller, Default, Large, Largest — and SHALL render a preview beside it that updates
as the choice changes. The preview SHALL be built from the app's real message rendering, showing a
user message and a weaver reply in their real bubble containers, not a placeholder or a lorem block.
Changing the choice SHALL apply the new size immediately, without leaving the settings page and
without a save step.

#### Scenario: The control and its preview

- **WHEN** the user opens the *This device* section
- **THEN** a text-size control and a preview of a user message and a weaver reply are shown together

#### Scenario: The preview follows the choice

- **WHEN** the user selects a different text-size step
- **THEN** the preview's text resizes to that step as the selection changes, alongside the rest of the
  page

#### Scenario: The preview is real message rendering

- **WHEN** the preview renders
- **THEN** it uses the same message body and bubble containers the chat uses, so it shows real
  message-shaped text and the user-versus-weaver layout rather than a lorem block

### Requirement: The text-size choice is device-local, app-wide and safe at its extremes

The text-size choice SHALL persist on the device across reloads and SHALL apply one app-wide type
scale, so the weaver chat and every other surface resize together and no surface is left at a stale
size. The Default step SHALL match today's size exactly, so an untouched install looks unchanged. At
the smallest step the reading text SHALL remain legible, and at the largest step the chat, the
composer and the decisions pane SHALL NOT overflow, clip or become unusable.

#### Scenario: The choice survives a reload

- **WHEN** the user selects a text-size step and reloads the app
- **THEN** the app starts at that step

#### Scenario: The scale applies app-wide

- **WHEN** the user changes the text size
- **THEN** the weaver chat and the rest of the app resize together, with no surface left at the old
  size

#### Scenario: The default is unchanged

- **WHEN** the preference has never been set
- **THEN** every surface renders at exactly the size it did before the preference existed

#### Scenario: The extremes hold the layout

- **WHEN** the smallest and the largest steps are rendered at desktop and phone width
- **THEN** the smallest reading text is legible and the largest does not overflow or clip the chat,
  the composer or the decisions pane
