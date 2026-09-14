## ADDED Requirements

### Requirement: The overview marks a project with YOLO mode on

When YOLO mode is on for the project, the overview's header SHALL show a visible marker saying that
the daemon grants that project's plan and merge approvals itself and that action approvals still
come to the human. When the mode is off, no such marker SHALL be shown.

#### Scenario: A project with the mode on

- **WHEN** the overview renders for a project whose `policies.yolo` is true
- **THEN** its header shows a marker naming the mode and that action approvals still come to the human

#### Scenario: A project with the mode off

- **WHEN** the overview renders for a project with no YOLO mode
- **THEN** no YOLO marker is shown
