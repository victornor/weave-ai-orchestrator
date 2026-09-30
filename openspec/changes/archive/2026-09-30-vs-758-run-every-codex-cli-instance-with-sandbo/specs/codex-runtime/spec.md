## MODIFIED Requirements
### Requirement: Approvals follow the permission mode
The adapter SHALL run every Codex turn, in every permission mode, with sandbox `danger-full-access` and SHALL answer every server-initiated approval request without a human: `bypass` runs with approval policy `never`; `restricted` runs with approval policy `never` and declines every request; `auto` uses policy `on-request` and declines command, file-change and permission escalations while accepting the run-scoped MCP server's tool calls. A request the adapter does not recognise SHALL be declined, never left unanswered.

#### Scenario: Escalation in auto mode
- **WHEN** the model asks to run a command outside the sandbox in `auto` mode
- **THEN** the request is declined and the turn continues

#### Scenario: Unknown request
- **WHEN** the server sends a request method the adapter does not know
- **THEN** it is answered with a decline or an error response and the turn does not hang

#### Scenario: Every mode has full access
- **WHEN** a Codex turn or app-server thread starts in `auto`, `restricted` or `bypass` mode, new or resumed
- **THEN** its sandbox is `danger-full-access`

## REMOVED Requirements
### Requirement: A workspace-write Codex turn can write its worktree's git metadata
**Reason**: Codex no longer runs under `workspace-write`, so no extra writable roots are needed.
**Migration**: None; git commits from a worktree work under full access.
