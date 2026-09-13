## MODIFIED Requirements

### Requirement: A workspace group expands into that workspace's sections

Each workspace group SHALL carry a control that expands and collapses it, and SHALL report whether
it is currently expanded to assistive technology. An expanded group SHALL contain a link to each of
that workspace's sections — Chat, Needs you, Board, Live, Roles, Runs, Usage, Knowledge and Settings
— in the same order the app uses for the active workspace, each addressing that section of that
workspace.

A collapsed group SHALL show its header, including its signals, and none of its section links.

The group of the workspace the app is currently showing SHALL always be expanded and SHALL NOT be
collapsible, so the section being viewed is never hidden.

#### Scenario: Expanding another workspace

- **WHEN** the human expands the group of a workspace that is not the active one
- **THEN** that group's section links become visible, each addressing that workspace, including Live

#### Scenario: Collapsing

- **WHEN** the human collapses an expanded group of a non-active workspace
- **THEN** that group's section links are no longer shown and its header, with its count, remains

#### Scenario: The active workspace cannot be collapsed

- **WHEN** the sidebar renders the group of the workspace currently being shown
- **THEN** that group is expanded and offers no control that would collapse it
