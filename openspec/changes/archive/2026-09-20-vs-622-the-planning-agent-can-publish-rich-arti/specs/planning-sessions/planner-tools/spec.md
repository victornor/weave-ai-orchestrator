## MODIFIED Requirements

### Requirement: The planner reads the project, never writes to it, and the guarantee is enforced, not assumed

The planning agent SHALL be able to read the project's repository, knowledge base, specs, open
tickets and roles. It SHALL NOT be able to modify the repository in any way. Publishing a plan artifact
is workspace storage attached to the plan, not a repository or project write, and SHALL NOT be treated
as one; the artifact tools the planner may call SHALL write only into its own plan's artifact store.
This guarantee SHALL be enforced by denying every write-capable action available to the agent's
runtime for the entire session, not only by the absence of a write-shaped tool from its MCP tool list.

#### Scenario: The planner can read project context

- **WHEN** the planning agent looks up open tickets, specs, knowledge documents or roles for its
  plan's project
- **THEN** it receives the current data for that project

#### Scenario: The planner has no path to edit the repository

- **WHEN** the planning agent's available tools are listed
- **THEN** no tool that writes to the project's repository (create, edit, commit, or open a pull
  request) is present

#### Scenario: An attempted file write or state-changing command is refused

- **WHEN** the planning agent's turn attempts to write a file or run a state-changing command through
  any capability its runtime would otherwise offer
- **THEN** the attempt is refused by the runtime itself, and no file in the project's repository
  changes as a result

#### Scenario: Publishing a plan artifact writes no repository file

- **WHEN** the planning agent publishes an artifact to its own plan
- **THEN** the artifact is stored against that plan, no file in the project's repository changes, and
  no project setting changes
