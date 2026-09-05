# workspace-navigation/workspace-signals Specification

## Purpose
Describes the per-workspace signal the sidebar shows for every workspace at once — how many
decisions are waiting for the human in each — including where the number comes from for the
workspace being shown and for the others, and how fresh each is required to be.

## Requirements

### Requirement: The workspace list reports how many decisions await the human

The daemon's workspace list SHALL report, for each workspace it lists, the number of decisions in
that workspace that are open and owned by the human. A workspace with none SHALL report zero, never
omit the number.

Producing the number SHALL NOT require loading a workspace that is not already loaded.

#### Scenario: A workspace with waiting decisions

- **WHEN** a workspace holds two open decisions owned by the human and one that has been answered
- **THEN** the workspace list reports two for that workspace

#### Scenario: A workspace holding decisions owned by an agent

- **WHEN** a workspace's only open decision is owned by an agent rather than the human
- **THEN** the workspace list reports zero for that workspace

#### Scenario: An idle workspace

- **WHEN** a workspace has no decisions at all
- **THEN** the workspace list reports zero for it

### Requirement: Each workspace header shows its Needs-you count

Every workspace group in the sidebar SHALL show that workspace's count of decisions awaiting the
human on its header, whether the group is expanded or collapsed. A count of zero SHALL show nothing
rather than a zero.

#### Scenario: A collapsed workspace with work waiting

- **WHEN** a collapsed workspace has three decisions awaiting the human
- **THEN** its header shows three

#### Scenario: Nothing waiting

- **WHEN** a workspace has no decisions awaiting the human
- **THEN** its header shows no count

### Requirement: The active workspace's count is live and the others refresh on an interval

The active workspace's count SHALL come from the same live data as its Needs-you section, so it
changes as soon as a decision is raised or answered in that workspace. Where the live value and the
listed value disagree for the active workspace, the live value SHALL be shown.

The counts for the other workspaces SHALL be refreshed at least every minute while the app is open,
by re-reading the workspace list, and SHALL NOT require an event subscription per workspace.

#### Scenario: A decision is raised in the active workspace

- **WHEN** a decision that needs the human is raised in the workspace being shown
- **THEN** that workspace's header count rises without waiting for the refresh interval

#### Scenario: A decision is raised elsewhere

- **WHEN** a decision that needs the human is raised in a workspace that is not being shown
- **THEN** that workspace's header count reflects it within a minute

#### Scenario: One request covers every workspace

- **WHEN** the app refreshes the counts for eight loaded workspaces
- **THEN** it makes one workspace-list request and opens no additional event subscription
