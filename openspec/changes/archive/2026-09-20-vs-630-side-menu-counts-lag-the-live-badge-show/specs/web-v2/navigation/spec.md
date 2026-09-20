## ADDED Requirements

### Requirement: The rail's counts are live on every signed-in page

The shell SHALL hold the daemon-wide multiplexed event stream on every signed-in page, not only on
global pages, so that a count the rail shows for any workspace is invalidated by that workspace's
events wherever the rail is rendered. The rail SHALL correct itself from those events without a
navigation, a document reload, a shorter polling interval, or a connection per workspace.

#### Scenario: A worker starts in another workspace on a workspace page

- **WHEN** the app is on workspace Alpha's page and a worker starts in workspace Beta
- **THEN** the rail's Live count includes Beta's worker without navigating anywhere

#### Scenario: A worker finishes in another workspace on a workspace page

- **WHEN** the app is on workspace Alpha's page and a worker in workspace Beta finishes its turn
- **THEN** the rail's Live count drops Beta's worker without navigating anywhere

#### Scenario: A decision in another workspace updates the rail

- **WHEN** the app is on workspace Alpha's page and a human-owned decision is created in workspace Beta
- **THEN** the rail's Needs-you count includes Beta's decision without navigating anywhere

#### Scenario: The shell opens no connection per workspace

- **WHEN** a signed-in page renders the shell
- **THEN** the shell holds one daemon-wide live connection shared by the whole document, and opens no connection of its own per workspace