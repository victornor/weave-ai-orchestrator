# web-v2/navigation — delta

## ADDED Requirements

### Requirement: The phone More list switches workspace

At phone width the V2 app SHALL offer a way to change the workspace from the shell's own navigation,
reachable in at most two taps from any screen: opening **More**, then choosing a workspace. The phone
More list SHALL carry a **Workspaces** group listing every workspace the daemon reports, each row
carrying the workspace's name and its open Needs-you count, and SHALL mark the workspace currently
shown. Activating a row SHALL switch the app to that workspace, landing on that workspace's Needs you
screen. The group SHALL appear on a global (Everywhere) page as well as a workspace page, so a
workspace can be reached from either.

#### Scenario: Two taps switch the workspace

- **WHEN** a phone-width app is on any screen and the user opens More and activates another workspace's row
- **THEN** the app shows that workspace's Needs you screen and the shell's workspace scope is that workspace

#### Scenario: The group lists every workspace

- **WHEN** the user opens More at phone width
- **THEN** every workspace the daemon reports appears in a Workspaces group, each row carrying its name and its open Needs-you count

#### Scenario: The current workspace is marked

- **WHEN** the More list's Workspaces group renders
- **THEN** the workspace the app is currently showing is distinguished from the others

#### Scenario: Reachable from a global page

- **WHEN** the user opens More from a global (Everywhere) page
- **THEN** the Workspaces group still lists every workspace and a row still switches to it
