# worker-provisioning/runtime-skill-path Specification

## Purpose
Keeps a worker home's installed skills at the path its currently-resolved runtime actually reads, so a
worker can always load its operating-contract skills regardless of which runtime it was first spawned on
or later moved to.

## Requirements

### Requirement: A worker's installed skills track its currently-resolved runtime

A worker home's skills SHALL be installed under the skill path of the runtime that is actually resolved
for that agent at the time its home is rendered — never a runtime that was resolved on some earlier
render and has since gone stale. Each shipped skill SHALL be installed only for the agent kinds its
`skills/manifest.json` entry declares as its audience (`worker`, `conductor`, or `all` for both).

#### Scenario: A freshly rendered worker home gets skills at its resolved runtime's path

- **WHEN** a worker's home is rendered and its currently-resolved runtime is `claude`
- **THEN** every worker-audience skill (and every `all`-audience skill) is installed under the path
  `skills/manifest.json` declares for `claude`
- **AND** no worker-audience skill is installed under any other runtime's path

#### Scenario: A different runtime resolves to a different path

- **WHEN** a worker's home is rendered and its currently-resolved runtime is `opencode` instead of `claude`
- **THEN** every worker-audience skill is installed under the path `skills/manifest.json` declares for
  `opencode`

#### Scenario: A conductor-audience skill never lands in a worker home

- **WHEN** a worker's home is rendered
- **THEN** no skill whose `skills/manifest.json` audience is `conductor` is installed in that home

### Requirement: A worker home re-installs skills when its resolved runtime changes after the home exists

If a worker's currently-resolved runtime no longer matches the runtime its home was last rendered for, the
next time that home is prepared for a turn SHALL re-render it — installing skills at the new runtime's
path — the same way a moved brief or role-spec revision already forces a re-render. A stale copy left
behind under the old runtime's path is not itself a failure; the requirement is that the new runtime's
path is populated.

#### Scenario: A worker's resolved runtime changes between two turns

- **WHEN** a worker's home was last rendered while its resolved runtime was `opencode`, and a later turn
  resolves its runtime as `claude`
- **THEN** preparing that worker's home for the later turn re-renders it
- **AND** the worker-audience skills are present under the path `skills/manifest.json` declares for
  `claude`

#### Scenario: A worker's resolved runtime is unchanged between two turns

- **WHEN** a worker's home was last rendered for its currently-resolved runtime and nothing else that
  already forces a re-render (brief or role-spec revision) has moved
- **THEN** preparing that worker's home for the next turn does not need to re-render it on account of the
  runtime
