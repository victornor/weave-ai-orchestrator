## MODIFIED Requirements

### Requirement: Every section is filed under the scope its data actually has

A section SHALL belong to the workspace area when its data belongs to the current workspace, and to
the daemon area when its data belongs to the daemon and is therefore the same from every workspace.
The workspace area's sections SHALL be shown by the workspace settings, and the daemon area's
sections SHALL be shown by the daemon settings.

The workspace area SHALL hold the workspace's own settings (its name and identifier, its automatic
approval policy, its knowledge budgets), its projects, its model settings, its channels, and its
presentation surfaces. Scheduled tasks (routines) SHALL NOT be a settings section; they SHALL be
reached from the daemon-level Scheduled page. The model settings SHALL be one section holding both
of the workspace's model settings and nothing else; there SHALL NOT be a separate section for the
conductor, whose only settings were its runtime and its model. The list of workspaces SHALL be
reachable from the workspace area, as the way to leave for another workspace.

The daemon area SHALL hold the daemon's update and upgrade state, the operator's account,
two-factor authentication and signed-in devices, the dictation backend and Voxtype model, and the
optional model overlays (conductor setting, workers default, and named worker-options catalog).
Settings that exist only in this browser — including dictation diagnostics capture — SHALL remain in
the This-device section, not in the daemon dictation section.

#### Scenario: A workspace setting is in the workspace area

- **WHEN** the operator looks for the current workspace's name, automatic approval policy, knowledge budgets, projects, model settings, channels or presentation surfaces
- **THEN** each is found in the workspace settings

#### Scenario: A daemon setting is in the daemon area

- **WHEN** the operator looks for the daemon's updates, their password, their two-factor authentication, their signed-in devices, the dictation backend, or the daemon model overlays
- **THEN** each is found in the daemon settings

#### Scenario: The workspace list is reachable from the workspace area

- **WHEN** the workspace settings are shown
- **THEN** they offer the other workspaces on this daemon and opening one leaves for that workspace

## ADDED Requirements

### Requirement: A leftover scheduled-tasks settings link opens the Scheduled page

A workspace settings URL that names the scheduled-tasks section SHALL redirect to the Scheduled
page, carrying that workspace so the page can show it, rather than 404ing or falling back to
another settings section. The Scheduled page is not a settings area; this redirect is the
migration for links that still name the removed section.

#### Scenario: An old scheduled settings link is redirected

- **WHEN** a workspace settings URL names the scheduled-tasks section
- **THEN** the Scheduled page opens, and that workspace is the one the URL asked to show
