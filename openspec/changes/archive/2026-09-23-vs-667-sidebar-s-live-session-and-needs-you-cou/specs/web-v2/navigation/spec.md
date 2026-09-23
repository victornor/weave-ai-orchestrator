## MODIFIED Requirements

### Requirement: The rail's counts are live on every signed-in page

The shell SHALL hold the daemon-wide multiplexed event stream on every signed-in page, not only on
global pages, so that a count the rail shows for any workspace is invalidated by that workspace's
events wherever the rail is rendered. The rail SHALL correct itself from those events without a
navigation, a document reload, a shorter polling interval, or a connection per workspace.

This SHALL hold for both counters and for both directions. A decision that becomes open SHALL raise
the count; a decision that is answered, superseded or expired — including one the daemon grants under
a project's automatic-approval mode — SHALL lower it, without the Needs you screen being opened. The
count SHALL move on the Everywhere figure and on each workspace group's own row, so a workspace row
cannot stay high or low after the workspace's decision state has changed.

#### Scenario: A worker starts in another workspace on a workspace page

- **WHEN** the app is on workspace Alpha's page and a worker starts in workspace Beta
- **THEN** the rail's Live count includes Beta's worker without navigating anywhere

#### Scenario: A worker finishes in another workspace on a workspace page

- **WHEN** the app is on workspace Alpha's page and a worker in workspace Beta finishes its turn
- **THEN** the rail's Live count drops Beta's worker without navigating anywhere

#### Scenario: A decision in another workspace updates the rail

- **WHEN** the app is on workspace Alpha's page and a human-owned decision is created in workspace Beta
- **THEN** the rail's Needs-you count includes Beta's decision without navigating anywhere

#### Scenario: A decision closing drops the count

- **WHEN** a human-owned decision that the rail counts is answered, superseded or auto-granted elsewhere
- **THEN** the rail's Needs-you count drops it on the Everywhere figure and on that workspace's row, without the Needs you screen being opened

#### Scenario: A workspace row is corrected too

- **WHEN** a workspace other than the one being shown gains or loses a counted decision
- **THEN** that workspace group's own Needs-you row moves with its state, not only the Everywhere figure

#### Scenario: The shell opens no connection per workspace

- **WHEN** a signed-in page renders the shell
- **THEN** the shell holds one daemon-wide live connection shared by the whole document, and opens no connection of its own per workspace