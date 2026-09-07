## MODIFIED Requirements

### Requirement: The phone announces the update where its navigation lives

On a viewport with no rail, the web app SHALL announce the daemon's release state on the navigation target that opens the rest of the app's navigation, SHALL carry the same announcement at the top of the menu that target opens, opening the section that shows the update state, and SHALL offer an entry at the top of settings that opens the same section.

Announcing it SHALL NOT change the geometry of the phone navigation bar: the announcement SHALL sit outside the bar's layout flow, as the other counts on that bar do.

The entry at the top of settings SHALL NOT be shown while the section it opens is already the one being shown.

#### Scenario: An update is available on a phone

- **WHEN** an update is available and the viewport has no rail
- **THEN** the navigation target that opens the app's navigation menu is badged, and the bar's tab and button geometry is unchanged

#### Scenario: Opening the update section from the navigation menu

- **WHEN** the navigation menu is opened on a phone while an update is available
- **THEN** an entry at the top of the menu names the update and opens the section that shows the update state

#### Scenario: Opening the update section from settings on a phone

- **WHEN** settings is opened on a phone while an update is available
- **THEN** an entry at the top of settings names the update and opens the section that shows the update state

#### Scenario: Already in the update section

- **WHEN** the section showing the update state is the one being shown
- **THEN** the entry at the top of settings is not shown
