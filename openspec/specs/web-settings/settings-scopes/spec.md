# web-settings/settings-scopes Specification

## Purpose
Defines how the web app's Settings page tells the operator what each setting applies to: the
separation of daemon-wide settings from the current workspace's settings and from state held only in
this browser, which section belongs to which, and the URL contract that makes an area and a section
deep-linkable from anywhere in the app.

## Requirements

### Requirement: Settings is split into a workspace area and a daemon area

Settings SHALL be two destinations, not one page with a switch: the workspace settings, which hold
only the settings that apply to the current workspace, and the daemon settings, which hold only the
settings that apply to the whole daemon and live at their own route above the workspaces. Neither
destination SHALL offer the other's sections, and neither SHALL offer a control for switching
between the two areas. Every section SHALL belong to exactly one area.

Moving between the two destinations SHALL NOT change any setting.

#### Scenario: Both areas are offered

- **WHEN** settings is opened from the navigation entry that owns its scope
- **THEN** both areas exist as their own destinations, each labelled, and the one opened shows only its own area's sections, with no control on the page for switching areas

#### Scenario: Only the selected area's sections are listed

- **WHEN** either destination is shown
- **THEN** it lists the sections of its own area and none of the sections of the other area

#### Scenario: Switching area changes nothing

- **WHEN** the operator moves from the workspace settings to the daemon settings or back
- **THEN** no setting is written to the daemon, to any workspace or to this browser

### Requirement: Every section is filed under the scope its data actually has

A section SHALL belong to the workspace area when its data belongs to the current workspace, and to
the daemon area when its data belongs to the daemon and is therefore the same from every workspace.
The workspace area's sections SHALL be shown by the workspace settings, and the daemon area's
sections SHALL be shown by the daemon settings.

The workspace area SHALL hold the workspace's own settings (its name and identifier, its automatic
approval policy, its knowledge budgets), its projects, its model settings, its channels, its
presentation surfaces, and its scheduled tasks (routines). The model settings SHALL be one section
holding both of the workspace's model settings and nothing else; there SHALL NOT be a separate
section for the conductor, whose only settings were its runtime and its model. The list of
workspaces SHALL be reachable from the workspace area, as the way to leave for another workspace.

The daemon area SHALL hold the daemon's update and upgrade state, the operator's account,
two-factor authentication and signed-in devices, the dictation backend and Voxtype model, and the
optional model overlays (conductor setting, workers default, and named worker-options catalog).
Settings that exist only in this browser — including dictation diagnostics capture — SHALL remain in
the This-device section, not in the daemon dictation section.

#### Scenario: A workspace setting is in the workspace area

- **WHEN** the operator looks for the current workspace's name, automatic approval policy, knowledge budgets, projects, model settings, channels, presentation surfaces or scheduled tasks
- **THEN** each is found in the workspace settings

#### Scenario: A daemon setting is in the daemon area

- **WHEN** the operator looks for the daemon's updates, their password, their two-factor authentication, their signed-in devices, the dictation backend, or the daemon model overlays
- **THEN** each is found in the daemon settings

#### Scenario: The workspace list is reachable from the workspace area

- **WHEN** the workspace settings are shown
- **THEN** they offer the other workspaces on this daemon and opening one leaves for that workspace

### Requirement: Settings held only in this browser are labelled as this device's

Settings that are stored in the browser rather than on the daemon or in a workspace — the colour
theme and the notification preferences — SHALL be presented together in a section that names the
device as their scope and SHALL state that they are stored in this browser only. They SHALL NOT be
presented as belonging to the workspace or to the daemon. The section SHALL sit in the daemon area
— it does not vary by workspace — and its own label and copy SHALL remain what tells the operator
its true scope, since the daemon settings page presents it under a heading that names the daemon as
the scope.

#### Scenario: Device settings are grouped and named

- **WHEN** the operator opens the section holding the theme and the notification preferences
- **THEN** the section is labelled as this device's and says the settings are stored in this browser only

#### Scenario: The theme is not offered as a workspace setting

- **WHEN** the workspace settings are shown
- **THEN** the colour theme is not among its settings

### Requirement: Daemon-level settings read the same from every workspace

The daemon settings SHALL show the same daemon state regardless of which workspace, if any, the
operator came from, and SHALL NOT hold a separate copy of that state per workspace. The daemon
settings SHALL be reachable and fully functional without any workspace having been entered, and a
daemon-level setting changed there SHALL be the state the daemon settings show when next viewed,
without the operator having to reload the app.

#### Scenario: The same daemon state from another workspace

- **WHEN** the daemon settings are opened after working in one workspace and then after working in another
- **THEN** both show the same daemon update state, account, device list, dictation backend and model overlays

#### Scenario: A daemon-level change is not stale in another workspace

- **WHEN** a daemon-level setting is changed and the daemon settings are then opened again, whatever workspace the operator was in
- **THEN** the change is shown, and no per-workspace copy of the earlier state is shown

### Requirement: The URL identifies the area and the section

Each destination SHALL carry its selected section in the URL, and selecting a section SHALL update
the URL without adding a history entry for each click. Opening that URL SHALL restore the same
section. A URL that names a section that does not belong to the destination being opened SHALL
redirect to the destination that owns it with the same section, rather than showing nothing or
silently showing the wrong scope: a workspace settings URL naming the daemon area or a daemon
section SHALL land on the daemon settings at that section, and a daemon settings URL naming a
workspace section SHALL land on that section of a workspace's settings — the workspace this browser
remembers — or, when this browser remembers no workspace, on the daemon settings' own first
section. A URL naming a section that does not exist at all SHALL fall back to the first section of
the destination being opened rather than showing nothing.

#### Scenario: Selecting a section is reflected in the URL

- **WHEN** the operator selects a section of either destination
- **THEN** the URL names it, and returning to that URL restores that section

#### Scenario: A link addresses a section by key alone

- **WHEN** a link opens either destination naming only a section by its key, such as the daemon's updates
- **THEN** that section is the one shown

#### Scenario: A workspace settings link naming the daemon side is redirected

- **WHEN** a workspace settings URL names the daemon area, or names a daemon section
- **THEN** the daemon settings open showing that section, not a workspace page showing daemon state

#### Scenario: A daemon settings link naming a workspace section is redirected

- **WHEN** a daemon settings URL names a workspace section
- **THEN** the remembered workspace's settings open showing that section; with no remembered workspace, the daemon settings' first section is shown instead, and no error is displayed

#### Scenario: An unknown section falls back

- **WHEN** either destination is opened with a section that does not exist
- **THEN** that destination's first section is shown, and no error is displayed

### Requirement: Every section stays reachable on a phone

On a phone, where the navigation menu the More tab opens is the way to destinations the bottom bar
leaves out, both destinations and every section within them SHALL be reachable: the menu's global
block SHALL offer the daemon settings, and its workspace destinations SHALL offer the workspace
settings. No section SHALL become unreachable because of the destination the operator arrived at.

#### Scenario: Reaching a daemon section from the More tab

- **WHEN** the operator opens the More menu on a phone and enters the daemon settings from its global block
- **THEN** the daemon area's sections are offered and each can be opened

#### Scenario: Reaching the workspace settings from the More menu

- **WHEN** the operator opens the More menu on a phone
- **THEN** the workspace destinations offer the workspace settings, and opening it shows the workspace area's sections, each of which can be opened

### Requirement: Each destination is entered from the navigation that owns its scope

The navigation SHALL offer settings at both scopes: the sidebar's daemon-level block, alongside the
other daemon-wide destinations, SHALL offer an entry that opens the daemon settings directly,
without entering a workspace; and each workspace's own navigation SHALL offer Settings that opens
that workspace's settings. The workspace entry SHALL NOT lead to daemon sections, and the daemon
entry SHALL NOT lead to workspace sections.

#### Scenario: Daemon settings from the sidebar's global block

- **WHEN** the operator uses the settings entry in the sidebar's daemon-level block
- **THEN** the daemon settings open without any workspace having been entered

#### Scenario: Workspace settings from a workspace's navigation

- **WHEN** the operator uses a workspace's own Settings entry
- **THEN** that workspace's settings open, showing only workspace sections

### Requirement: Each destination names its scope

The workspace settings SHALL name the workspace they configure, and the daemon settings SHALL say
they apply to the whole daemon, so that with several workspaces the operator can always tell which
scope the page in front of them changes. A page whose scope must be inferred SHALL NOT be shown.

#### Scenario: The workspace settings name their workspace

- **WHEN** the workspace settings are shown
- **THEN** the page names the workspace it configures

#### Scenario: The daemon settings read as daemon-wide

- **WHEN** the daemon settings are shown
- **THEN** the page says the settings apply to the whole daemon
