## MODIFIED Requirements

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

The daemon area SHALL hold the daemon's update and upgrade state and the operator's account,
two-factor authentication and signed-in devices.

#### Scenario: A workspace setting is in the workspace area

- **WHEN** the operator looks for the current workspace's name, automatic approval policy, knowledge budgets, projects, model settings, channels or presentation surfaces
- **THEN** each is found in the workspace area

#### Scenario: A daemon setting is in the daemon area

- **WHEN** the operator looks for the daemon's updates, their password, their two-factor authentication or their signed-in devices
- **THEN** each is found in the daemon area

#### Scenario: The workspace list is reachable from the workspace area

- **WHEN** the workspace area is shown
- **THEN** it offers the other workspaces on this daemon and opening one leaves for that workspace
