## ADDED Requirements

### Requirement: The phone More sheet carries the light/dark switch

The phone layout SHALL carry the in-app light/dark switch in the More sheet — the menu the phone tab
bar opens for the destinations and settings-style entries it leaves out — since the sidebar footer
that carries the switch on desktop is not shown at phone width. The sheet's switch SHALL drive the
same theme choice as the rail footer's switch through the same state and the same device-persisted
key, so the two surfaces cannot disagree and no second theme mechanism or storage key exists.

#### Scenario: A phone can change the theme

- **WHEN** the app is shown at phone width and the user opens the More sheet
- **THEN** the sheet carries the light/dark switch, and activating it repaints the V2 app in the
  other theme without a reload

#### Scenario: The phone and the rail share one choice

- **WHEN** the theme is changed from the More sheet and the app is later shown at desktop width
- **THEN** the rail footer's switch shows that same theme, and neither surface has a persisted choice
  of its own

#### Scenario: The choice survives a reload after a phone change

- **WHEN** the theme is chosen from the More sheet and the app is reloaded
- **THEN** the V2 app starts in the chosen theme, under the same key the rail footer switch writes
