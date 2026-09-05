## MODIFIED Requirements

### Requirement: The web app announces an available update without being asked

When an update is available, the web app SHALL show a named entry in its navigation — one that says an update is available and names the target it would move to — so an operator who is not looking at settings learns that one exists and what it is. The entry SHALL offer a way to open the section that shows the update state and offers the upgrade, addressed by section rather than by position, so that reordering the settings sections cannot strand it.

While an upgrade is in flight, the entry SHALL say that the daemon is being upgraded and name the stage it is in, rather than continuing to announce an available update.

When no update is available, when an upgrade has reached a terminal state with nothing left to announce, when checking is not configured, or when the check failed, the navigation SHALL show nothing.

The same fact SHALL be announced once per viewport: the entry SHALL NOT be accompanied by a second indicator saying the same thing.

#### Scenario: An update is available

- **WHEN** the daemon reports an update as available
- **THEN** the navigation shows an entry saying so, naming the target ref and commit, and offering to open the section that shows the update state

#### Scenario: Opening the update section from the entry

- **WHEN** the entry's action is used
- **THEN** the settings section that shows the update state and offers the upgrade is the one shown, reached by naming that section rather than its position

#### Scenario: An upgrade is in flight

- **WHEN** an upgrade has been requested and has not reached a terminal state
- **THEN** the navigation says the daemon is being upgraded and names the stage, and no longer announces an available update

#### Scenario: The daemon is up to date

- **WHEN** the daemon reports no update as available and no upgrade is in flight
- **THEN** the navigation shows no update entry

#### Scenario: Update checking is not configured

- **WHEN** the daemon reports that update checking is not configured
- **THEN** the navigation shows no update entry and no error

#### Scenario: The check failed

- **WHEN** the update check itself failed
- **THEN** the navigation shows no update entry

## ADDED Requirements

### Requirement: A settings section can be opened directly by URL

The web app SHALL be able to open its settings on a named section from a URL, and the section SHALL be identified by a stable key rather than by its position among the sections. A URL that names no section, or one that is not a section, SHALL open the first section rather than an empty or broken state.

Choosing a section in the app SHALL keep working as it does and SHALL write the chosen key back into the URL, so that the address bar always names what is being shown and the view can be reloaded or shared. Writing the section back SHALL preserve whatever else the URL carried.

#### Scenario: Opening a section from a URL

- **WHEN** settings is opened at a URL naming a section by key
- **THEN** that section is the one shown

#### Scenario: A URL that names no section

- **WHEN** settings is opened at a URL naming no section
- **THEN** the first section is shown

#### Scenario: A URL that names a section that does not exist

- **WHEN** settings is opened at a URL naming a section that is not one of the sections
- **THEN** the first section is shown, and nothing reports an error

#### Scenario: Choosing a section in the app

- **WHEN** a section is chosen from the settings tabs
- **THEN** that section is shown and the URL is updated to name it, keeping the rest of the URL's search intact

### Requirement: The phone announces the update where its navigation lives

On a viewport with no rail, the web app SHALL announce the daemon's release state on the navigation target that leads to settings, and SHALL offer an entry at the top of settings that opens the section showing the update state.

Announcing it SHALL NOT change the geometry of the phone navigation bar: the announcement SHALL sit outside the bar's layout flow, as the other counts on that bar do.

The entry at the top of settings SHALL NOT be shown while the section it opens is already the one being shown.

#### Scenario: An update is available on a phone

- **WHEN** an update is available and the viewport has no rail
- **THEN** the navigation target that leads to settings is badged, and the bar's tab and button geometry is unchanged

#### Scenario: Opening the update section from settings on a phone

- **WHEN** settings is opened on a phone while an update is available
- **THEN** an entry at the top of settings names the update and opens the section that shows the update state

#### Scenario: Already in the update section

- **WHEN** the section showing the update state is the one being shown
- **THEN** the entry at the top of settings is not shown
