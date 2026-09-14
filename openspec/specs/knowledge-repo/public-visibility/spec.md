# knowledge-repo/public-visibility Specification

## Purpose
Lets the daemon learn whether a project's repository is public, so the web app can warn a human before their project's knowledge is committed somewhere the world can read, on forges that can answer and silently absent on those that cannot.

## Requirements

### Requirement: A forge optionally reports whether a repository is public

The forge adapter SHALL gain an optional capability, `repoInfo(cwd, remote?)`, returning `{ private: boolean } | null` — `null` when the forge cannot determine visibility. A forge that does not implement it SHALL be treated exactly as one that returns `null`. The capability SHALL accept the remote to inspect as an optional argument, so it can answer before a project has been cloned.

#### Scenario: A forge that implements visibility

- **WHEN** the daemon asks a forge that implements the capability about a repository
- **THEN** it answers with the repository's private flag or `null`

#### Scenario: A forge without the capability

- **WHEN** the daemon asks a forge that does not implement the capability
- **THEN** the answer is `null` and nothing else about the flow changes

### Requirement: The built-in GitHub forge reports visibility through the gh CLI

The built-in `gh`-backed forge SHALL implement the capability with `gh repo view --json visibility`, mapping `PRIVATE` and `INTERNAL` to private and `PUBLIC` to not private, and SHALL return `null` when the command fails or the response cannot be parsed. It SHALL run the check without executing a coding CLI or touching a workspace runtime directory.

#### Scenario: A private repository

- **WHEN** `gh repo view` reports `PRIVATE`
- **THEN** the capability answers `{ private: true }`

#### Scenario: A public repository

- **WHEN** `gh repo view` reports `PUBLIC`
- **THEN** the capability answers `{ private: false }`

#### Scenario: gh cannot answer

- **WHEN** `gh repo view` fails or returns an unparseable or empty visibility
- **THEN** the capability answers `null`

### Requirement: Enabling a project on a public repository warns before confirming

When a human moves a project's knowledge-repo opt-in from off to on, the settings surface SHALL consult the forge's visibility and, when the repository is reported public, SHALL show a clear warning that the project's knowledge will be committed to a public repository before the change is confirmed. The warning SHALL be advisory only and SHALL never prevent the change. The same warning SHALL appear when the opt-in is checked in the project-creation form.

#### Scenario: Enabling on a public repository

- **WHEN** a human turns the opt-in on for a project whose forge reports the repository public
- **THEN** a warning naming the public repository is shown before the change is confirmed

#### Scenario: The warning never blocks

- **WHEN** the warning has been shown and the human confirms
- **THEN** the switch proceeds exactly as it would without the warning

#### Scenario: Enabling on a private repository

- **WHEN** a human turns the opt-in on for a project whose forge reports the repository private
- **THEN** no warning is shown

#### Scenario: A forge that cannot tell

- **WHEN** a human turns the opt-in on for a project whose forge reports no visibility
- **THEN** no warning is shown and the change proceeds
