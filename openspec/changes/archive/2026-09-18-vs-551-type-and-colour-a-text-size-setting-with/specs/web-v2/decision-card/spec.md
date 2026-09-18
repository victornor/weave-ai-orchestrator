## ADDED Requirements

### Requirement: The approve control and the reviewed-clean line are the same in both themes

The decision card's available Approve control SHALL read as the same inverse high-contrast action in
the dark theme and the light theme: a dark fill with white ink in light mode, and a near-white fill
with dark ink in dark mode, with no hue on the control in either theme. Green SHALL be removed from
the Approve control entirely. A blocked Approve SHALL use the same recipe in both themes, so a
disabled action does not look like a different control per theme.

The weaver's reviewed-clean line SHALL be the same green hue in both themes, at whatever lightness
each theme's ground needs for contrast, rather than a different hue per theme.

#### Scenario: The approve control in both themes

- **WHEN** an available Approve control is rendered in the dark theme and in the light theme
- **THEN** it is the inverse pair in both — dark fill with white ink in light, near-white fill with
  dark ink in dark — with no green in either, and each fill's own ink meets contrast

#### Scenario: A blocked approve is the same recipe

- **WHEN** an Approve control is blocked and rendered in the dark theme and in the light theme
- **THEN** it uses the same blocked recipe in both themes

#### Scenario: The reviewed-clean line is one hue

- **WHEN** the reviewed-clean line is rendered in the dark theme and in the light theme
- **THEN** it is the same green hue in both, at each theme's own lightness
