## MODIFIED Requirements

### Requirement: Each project's rail and More-list entry lists its roles' persistent chats

Below the project's **Roadmap** child row, the V2 shell SHALL list each role hired for that project as a secondary child row in the same style, in the desktop rail and in the phone **More** list. Activating an active role's row SHALL open that role's persistent session through the same open-or-resume operation the Roles screen and the project overview use — resuming the existing conversation, or starting one on first use — and SHALL land directly on that conversation, not on the Roles screen or the project overview. The navigation SHALL NOT depend on the row remaining mounted: closing the surface that holds the row (the phone **More** sheet) SHALL NOT cancel or drop the navigation, and that surface SHALL close only once the open has succeeded. When the open fails, the row SHALL remain mounted and SHALL keep showing its `not opened` state, and the surface SHALL NOT close over it. A project with no hired roles SHALL add no role row.

A role that cannot serve a session (its status is not `active`) SHALL still be listed, as a disabled, non-interactive row carrying the reason it cannot chat; it SHALL NOT be presented as an actionable control. The role whose session is the page currently shown SHALL be marked as the current row. A project with more roles than the shell lists SHALL show a final row stating how many roles are not shown, opening that project's overview.

#### Scenario: A project's roles sit under its Roadmap row

- **WHEN** the rail or the phone More list renders a project with hired roles
- **THEN** each role is a secondary child row below that project's Roadmap row, and a project with no roles adds no role row

#### Scenario: A role row opens the persistent conversation

- **WHEN** the user activates an active role's row
- **THEN** that role's persistent session opens, or starts on first use, and its conversation is shown without passing through the Roles screen or the project overview

#### Scenario: Closing the More sheet does not cancel the open

- **WHEN** the user activates an active role's row in the phone More sheet and the sheet closes as the open resolves
- **THEN** the app still lands on that role's conversation, even though the sheet unmounted the row before the open completed

#### Scenario: A failed open leaves the row and the sheet standing

- **WHEN** activating a role's row fails to open the session
- **THEN** the row stays mounted and still shows its not-opened state, and the More sheet does not close over the failure

#### Scenario: A role in another workspace opens against its own workspace

- **WHEN** the user activates a role row under a workspace the app is not currently showing
- **THEN** the open-or-resume call and the navigation both use that project's own workspace

#### Scenario: A role that cannot chat is shown disabled with its reason

- **WHEN** a listed role is paused, retired or awaiting hire approval
- **THEN** its row is not actionable and carries the reason it cannot chat

#### Scenario: The open conversation is marked

- **WHEN** the page shown is a role's persistent session
- **THEN** that role's row is marked as the current row

#### Scenario: Many roles are capped

- **WHEN** a project has more roles than the shell lists
- **THEN** the listed roles are followed by one row naming how many roles are not shown, opening that project's overview

#### Scenario: The phone More list carries the same rows

- **WHEN** a phone-width app opens More
- **THEN** each listed project carries the same role rows, opening the same persistent sessions
