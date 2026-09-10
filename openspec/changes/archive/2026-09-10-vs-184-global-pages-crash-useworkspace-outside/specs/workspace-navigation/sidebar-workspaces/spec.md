## ADDED Requirements

### Requirement: Global pages render without a workspace provider

The global Needs you, Live, Chats, Incidents and Map pages SHALL load and render when the URL has
no workspace id. Shared chrome on those pages SHALL NOT require a workspace to be the active one,
and SHALL NOT throw because no workspace context is present.

Visiting any of those pages SHALL NOT change the workspace remembered for the next time the app is
started. Per-workspace pages under a workspace path SHALL keep wrapping that workspace as the
active one.

#### Scenario: Global Needs you loads with no workspace in the URL

- **WHEN** the app opens the global Needs you page and no workspace is in the URL
- **THEN** the page renders, it does not show an error that workspace context is missing, and the
  workspace remembered for the next launch is unchanged

#### Scenario: The other global pages load the same way

- **WHEN** the app opens global Live, Chats, Incidents or Map and no workspace is in the URL
- **THEN** each page renders without an error that workspace context is missing, and the workspace
  remembered for the next launch is unchanged

#### Scenario: A per-workspace page still has a workspace

- **WHEN** the app opens a workspace's board
- **THEN** that workspace is the active one and the page still renders
