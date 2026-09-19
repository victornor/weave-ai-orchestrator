# web-v2/navigation — delta

## ADDED Requirements

### Requirement: Each project's rail and More-list entry lists its roles' persistent chats

Below the project's **Roadmap** child row, the V2 shell SHALL list each role hired for that project as a secondary child row in the same style, in the desktop rail and in the phone **More** list. Activating an active role's row SHALL open that role's persistent session through the same open-or-resume operation the Roles screen and the project overview use — resuming the existing conversation, or starting one on first use — and SHALL land directly on that conversation, not on the Roles screen or the project overview. A project with no hired roles SHALL add no role row.

A role that cannot serve a session (its status is not `active`) SHALL still be listed, as a disabled, non-interactive row carrying the reason it cannot chat; it SHALL NOT be presented as an actionable control. The role whose session is the page currently shown SHALL be marked as the current row. A project with more roles than the shell lists SHALL show a final row stating how many roles are not shown, opening that project's overview.

#### Scenario: A project's roles sit under its Roadmap row

- **WHEN** the rail or the phone More list renders a project with hired roles
- **THEN** each role is a secondary child row below that project's Roadmap row, and a project with no roles adds no role row

#### Scenario: A role row opens the persistent conversation

- **WHEN** the user activates an active role's row
- **THEN** that role's persistent session opens, or starts on first use, and its conversation is shown without passing through the Roles screen or the project overview

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
