## ADDED Requirements

### Requirement: The workspace scope offers an MCP servers section

The workspace scope SHALL provide an MCP servers section, beside Providers, that lists the selected
workspace's configured servers and offers adding, editing and removing one. The list SHALL show each
server's name, its transport (`http` or `stdio`), its target (`url` or `command`) and whether its
referenced secrets are set. The section SHALL reach the daemon's MCP routes against the selected
workspace, not the one the app remembers, and SHALL state that a stdio server is arbitrary code the
human chose to run on the host.

#### Scenario: The list

- **WHEN** the MCP servers section renders for a workspace with two servers
- **THEN** it shows both with their transport, target and secret state, and no secret value appears
  anywhere on the section

#### Scenario: The stdio warning

- **WHEN** the MCP servers section renders
- **THEN** it states that a stdio server is a command the human chose to run on the host

#### Scenario: A non-active workspace scope

- **WHEN** the selected workspace is not the one the app remembers
- **THEN** the list and every write address the selected workspace

### Requirement: A server can be added, edited and removed

The section SHALL offer adding a server (a name, `type`, and the matching `url`/`headers` or
`command`/`args`/`env`/`readOnly`, and the timeouts), editing a saved one, and removing one. Editing
SHALL expose the server's `env` and `headers` with their `${SECRET_NAME}` references, the `readOnly`
flag, and the timeouts. Saving SHALL write the definition through the daemon's config; removing SHALL
require a confirmation before it is deleted. The reserved name `weave-ai` SHALL be refused with a
message.

#### Scenario: Add and save

- **WHEN** the user adds a `stdio` server with a command and saves it
- **THEN** the definition is written to the workspace config and appears in the list

#### Scenario: Edit and save

- **WHEN** the user changes a saved server's command or a timeout and saves
- **THEN** the change is written and the list re-reads it

#### Scenario: Remove asks first

- **WHEN** the user removes a server
- **THEN** a confirmation is required before it is deleted

### Requirement: Referenced secrets are entered through the secret input and never shown

A `${SECRET_NAME}` reference used by a server SHALL have its value entered through the existing
secret input — a masked field that is not autofilled and that never renders a stored value back —
with a separate control to clear it. Setting, replacing and clearing it SHALL go through the
workspace secret store, and the section SHALL show only whether the secret is set together with its
name. The value SHALL NOT appear in the rendered output or in any test snapshot.

#### Scenario: Entering a referenced secret

- **WHEN** the user types a value for a referenced secret and saves it
- **THEN** it is written to the workspace secret store and the section shows it as set, with no value

#### Scenario: A stored secret is never rendered

- **WHEN** the section renders for a referenced secret that is set
- **THEN** the field is empty and masked and the DOM contains no value

#### Scenario: Clearing a referenced secret

- **WHEN** the user clears a referenced secret
- **THEN** the section shows it as not set

### Requirement: A server can be tested by listing its tools

A saved server SHALL offer a Test action that connects to it and lists its tools within a short
timeout, rendering each tool's name and description, or the connection error. Testing SHALL NOT
persist anything. The section SHALL NOT claim a server is reachable until a test has returned its
tools.

#### Scenario: A passing test

- **WHEN** the server connects and answers `tools/list`
- **THEN** each tool is shown with its name and description

#### Scenario: A failing test

- **WHEN** the server cannot be reached or refuses the connection
- **THEN** the section shows the error and no tools

### Requirement: A role's allowed MCP servers are editable

The role surface SHALL offer a control to choose which of the workspace's MCP servers that role may
use, defaulting to none, and saving it SHALL write the role's `mcpServers` allow list through the
role update route. The control SHALL list the workspace's configured server names and SHALL NOT
grant a server to any role unless the human selects it.

#### Scenario: Allowing a server on a role

- **WHEN** the human selects a configured server on a role and saves
- **THEN** the role's `mcpServers` contains that server's name

#### Scenario: The default is none

- **WHEN** a role has never had servers chosen
- **THEN** the control shows none selected and the role's `mcpServers` is empty
