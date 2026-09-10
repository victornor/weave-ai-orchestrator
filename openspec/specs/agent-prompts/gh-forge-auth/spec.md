# agent-prompts/gh-forge-auth Specification

## Purpose
Always-loaded conductor and worker prompts tell every workspace's agents how
to invoke GitHub CLI forge commands when `gh auth status` looks logged-out,
so they never ask the human to authorize GitHub for that reason.

## Requirements

### Requirement: Worker AGENTS template carries the GH_TOKEN forge recipe

The always-loaded worker instruction template the daemon renders SHALL state
that if `gh auth status` looks logged-out, `gh` forge commands MUST be
invoked with `GH_TOKEN="$(gh auth token)"` in the environment. It SHALL
forbid running `gh auth login`. It SHALL forbid asking the human or the
conductor to authorize GitHub because status looks logged-out.

#### Scenario: Worker template names the recipe

- **WHEN** the shipped worker AGENTS.md template is read as source
- **THEN** it contains `GH_TOKEN="$(gh auth token)"`
- **AND** it forbids `gh auth login`
- **AND** it says not to ask the human to authorize GitHub because `gh auth status` looks logged-out

#### Scenario: Rendered worker instructions keep the recipe

- **WHEN** the daemon renders worker AGENTS.md from the shipped template
- **THEN** the rendered file contains `GH_TOKEN="$(gh auth token)"`
- **AND** the rendered file forbids `gh auth login`

### Requirement: Conductor AGENTS template does not treat logged-out gh status as an authorization ask

The always-loaded conductor instruction template the daemon renders SHALL
state that if `gh auth status` looks logged-out, that is not a reason to
ask the human to authorize GitHub. It SHALL name `GH_TOKEN="$(gh auth token)"`
as the way to invoke `gh` forge commands. It SHALL forbid running
`gh auth login`.

#### Scenario: Conductor template names the recipe

- **WHEN** the shipped conductor AGENTS.md template is read as source
- **THEN** it contains `GH_TOKEN="$(gh auth token)"`
- **AND** it forbids `gh auth login`
- **AND** it says not to ask the human to authorize GitHub because `gh auth status` looks logged-out

#### Scenario: Rendered conductor instructions keep the recipe

- **WHEN** the daemon renders conductor AGENTS.md from the shipped template
- **THEN** the rendered file contains `GH_TOKEN="$(gh auth token)"`
- **AND** the rendered file says not to ask the human to authorize GitHub for a logged-out `gh auth status`

### Requirement: Worker delivery procedure uses the same GH_TOKEN prefix

The worker delivery procedure for mode `pr` SHALL invoke `gh pr create` and
`gh pr merge` with `GH_TOKEN="$(gh auth token)"` in the environment. It SHALL
NOT instruct the worker to run `gh auth login`.

#### Scenario: Delivery skill prefixes gh forge commands

- **WHEN** the shipped worker delivery procedure is read as source
- **THEN** its `gh pr create` and `gh pr merge` commands are prefixed with `GH_TOKEN="$(gh auth token)"`
- **AND** the procedure does not contain `gh auth login`
