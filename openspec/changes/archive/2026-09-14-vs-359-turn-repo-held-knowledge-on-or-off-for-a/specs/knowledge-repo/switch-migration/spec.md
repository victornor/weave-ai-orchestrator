## Purpose

Moves a project's existing knowledge into or out of its own repository when a human turns the knowledge-repo opt-in on or off after the project already holds knowledge, through a reviewed pull request whose merge — not the request — is what changes the project's setting.

## ADDED Requirements

### Requirement: Turning the opt-in on for an existing project opens one reviewed pull request

When a human turns the knowledge-repo opt-in on for an existing project, the daemon SHALL copy that project's whole workspace knowledge tree (`knowledge/projects/<projectId>/**`, including its hub file, its documents and its archive) into `.weave/knowledge/` on a new branch off the project's landing tip, and SHALL open exactly one pull request carrying it. The daemon SHALL NOT change the project's opt-in setting at this point. The project's revision history SHALL NOT be replayed into git; the pull request's own commit is the first git revision of the copied files.

#### Scenario: Enabling a project that holds knowledge

- **WHEN** a human turns the opt-in on for a project whose workspace knowledge holds a hub file, documents and archive entries
- **THEN** the daemon opens one pull request whose changed files are only that project's `.weave/knowledge/` tree, and the project's opt-in remains off

#### Scenario: Nothing but the project's own tree enters the pull request

- **WHEN** the daemon builds the enabling pull request
- **THEN** no workspace hub, shared file, decisions log or other project's knowledge appears in its diff

### Requirement: The opt-in takes effect only when the enabling pull request merges

While the enabling pull request is open the project's knowledge-repo behavior SHALL remain off. When the pull request merges, the daemon SHALL enable the opt-in and fast-forward the project's primary clone. The daemon SHALL NOT require a ticket or a live worker to detect the merge.

#### Scenario: The enabling pull request merges

- **WHEN** the enabling pull request is merged on the forge
- **THEN** the project's opt-in reads enabled and its primary clone reflects the landed `.weave/knowledge/` tree

#### Scenario: The enabling pull request is closed without merging

- **WHEN** the enabling pull request is closed while still unmerged
- **THEN** the project's opt-in is still off, and no further enabling pull request is opened until a human asks again

### Requirement: Turning the opt-in off opens one pull request that removes the repository copy

When a human turns the knowledge-repo opt-in off for an opted-in project, the daemon SHALL open exactly one pull request deleting `.weave/knowledge/` from the repository, and SHALL NOT change the opt-in while it is open. When it merges the opt-in SHALL become disabled. The workspace's own knowledge copy SHALL be left untouched throughout, so disabling loses nothing.

#### Scenario: Disabling an opted-in project

- **WHEN** a human turns the opt-in off for an opted-in project
- **THEN** the daemon opens one pull request removing the project's `.weave/knowledge/` tree, and the workspace copy is unchanged

#### Scenario: A merged disabling pull request turns the opt-in off

- **WHEN** the disabling pull request is merged
- **THEN** the project's opt-in reads disabled and its workspace knowledge copy is still present and complete

#### Scenario: The disabling pull request is closed without merging

- **WHEN** the disabling pull request is closed while still unmerged
- **THEN** the project's opt-in is still enabled

### Requirement: A project has at most one pending switch, and it is cancelable

While a switch pull request is open the project SHALL have exactly one pending switch, carrying the direction and the pull request, and a further switch request SHALL be refused rather than opening a second pull request. Closing the pull request SHALL clear the pending switch without changing the opt-in.

#### Scenario: A second switch is requested while one is pending

- **WHEN** a switch is already pending and a human requests the opposite setting
- **THEN** the request is refused and no second pull request is opened

#### Scenario: Closing the pull request cancels the switch

- **WHEN** a pending switch's pull request is closed unmerged
- **THEN** the project has no pending switch and its opt-in is unchanged

#### Scenario: A refused or failed switch leaves the setting as it was

- **WHEN** enabling cannot be carried out because no forge can open a pull request
- **THEN** the opt-in remains off and the project records no pending switch

### Requirement: The pending switch is visible on the project

A project with a pending switch SHALL expose it on the project record as its direction and pull request, so a human can see that the setting is waiting on review and how to cancel it.

#### Scenario: Reading a project mid-switch

- **WHEN** a project has a pending enabling pull request
- **THEN** reading the project reports the pending switch, its direction and its pull request
