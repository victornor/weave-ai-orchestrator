# web-settings/settings-scopes Specification

## Purpose
Defines how the web app's Settings page tells the operator what each setting applies to: the
separation of daemon-wide settings from the current workspace's settings and from state held only in
this browser, which section belongs to which, and the URL contract that makes an area and a section
deep-linkable from anywhere in the app.

## Requirements

### Requirement: Settings is split into a workspace area and a daemon area

The Settings page SHALL present exactly two top-level areas, one for settings that apply to the
current workspace only and one for settings that apply to the whole daemon, each labelled so that the
operator can tell without reading a section which of the two they are changing. Every section of the
page SHALL belong to exactly one area, and the sections of the area that is not selected SHALL NOT be
offered alongside those of the selected one.

Switching area SHALL NOT change any setting.

#### Scenario: Both areas are offered

- **WHEN** the Settings page is opened
- **THEN** it offers a workspace area and a daemon area, each labelled, with one of them selected

#### Scenario: Only the selected area's sections are listed

- **WHEN** an area is selected
- **THEN** the page lists the sections of that area and none of the sections of the other area

#### Scenario: Switching area changes nothing

- **WHEN** the operator switches from one area to the other
- **THEN** no setting is written to the daemon, to the workspace or to this browser

### Requirement: Every section is filed under the scope its data actually has

A section SHALL be filed under the workspace area when its data belongs to the current workspace, and
under the daemon area when its data belongs to the daemon and is therefore the same from every
workspace.

The workspace area SHALL hold the workspace's own settings (its name and identifier, its automatic
approval policy, its knowledge budgets), its projects, its model settings, its channels and its
presentation surfaces. The model settings SHALL be one section holding both of the workspace's model
settings and nothing else; there SHALL NOT be a separate section for the conductor, whose only
settings were its runtime and its model. The list of workspaces SHALL be reachable from the
workspace area, as the way to leave for another workspace.

The daemon area SHALL hold the daemon's update and upgrade state, the operator's account,
two-factor authentication and signed-in devices, and the dictation backend and Voxtype model.
Settings that exist only in this browser — including dictation diagnostics capture — SHALL remain in
the This-device section, not in the daemon dictation section.

#### Scenario: A workspace setting is in the workspace area

- **WHEN** the operator looks for the current workspace's name, automatic approval policy, knowledge budgets, projects, model settings, channels or presentation surfaces
- **THEN** each is found in the workspace area

#### Scenario: A daemon setting is in the daemon area

- **WHEN** the operator looks for the daemon's updates, their password, their two-factor authentication, their signed-in devices, or the dictation backend
- **THEN** each is found in the daemon area

#### Scenario: The workspace list is reachable from the workspace area

- **WHEN** the workspace area is shown
- **THEN** it offers the other workspaces on this daemon and opening one leaves for that workspace

### Requirement: Settings held only in this browser are labelled as this device's

Settings that are stored in the browser rather than on the daemon or in a workspace — the colour
theme and the notification preferences — SHALL be presented together in a section that names the
device as their scope and SHALL state that they are stored in this browser only. They SHALL NOT be
presented as belonging to the workspace or to the daemon.

#### Scenario: Device settings are grouped and named

- **WHEN** the operator opens the section holding the theme and the notification preferences
- **THEN** the section is labelled as this device's and says the settings are stored in this browser only

#### Scenario: The theme is not offered as a workspace setting

- **WHEN** the workspace area is shown
- **THEN** the colour theme is not among its settings

### Requirement: Daemon-level settings read the same from every workspace

The daemon area SHALL show the same daemon state whichever workspace the page was opened from, and
SHALL NOT hold a separate copy of that state per workspace. A daemon-level setting changed while
viewing one workspace SHALL be the state the daemon area shows when it is next viewed from another
workspace, without the operator having to reload the app.

#### Scenario: The same daemon state from another workspace

- **WHEN** the daemon area is opened from one workspace and then from another
- **THEN** both show the same daemon update state, account, device list and dictation backend

#### Scenario: A daemon-level change is not stale in another workspace

- **WHEN** a daemon-level setting is changed while viewing one workspace and the daemon area is then opened from another workspace
- **THEN** the change is shown, and no per-workspace copy of the earlier state is shown

### Requirement: The URL identifies the area and the section

The Settings URL SHALL carry the selected area and the selected section, and selecting either SHALL
update the URL without adding a history entry for each click. Opening that URL SHALL restore the same
area and section.

A URL that names a section without naming an area SHALL resolve the area from the section, so a link
may address a section by its key alone. A URL naming an area or a section that does not exist SHALL
fall back to the first section of a valid area rather than showing nothing.

#### Scenario: Selecting a section is reflected in the URL

- **WHEN** the operator selects an area and a section
- **THEN** the URL names both, and returning to that URL restores that area and that section

#### Scenario: A link addresses a section by key alone

- **WHEN** a link opens Settings naming only a section, such as the daemon's updates
- **THEN** that section is shown, with its own area selected

#### Scenario: An unknown section falls back

- **WHEN** Settings is opened with an area or a section that does not exist
- **THEN** a valid area is selected with its first section shown, and no error is displayed

### Requirement: Every section stays reachable on a phone

On a phone, where Settings is reached from the navigation menu the More tab opens, both areas and
every section within them SHALL be reachable. No section SHALL become unreachable because it is in
the area that is not selected on arrival.

#### Scenario: Reaching a daemon section from the More tab

- **WHEN** the operator opens Settings from the More menu on a phone and switches to the daemon area
- **THEN** the daemon area's sections are offered and each can be opened
