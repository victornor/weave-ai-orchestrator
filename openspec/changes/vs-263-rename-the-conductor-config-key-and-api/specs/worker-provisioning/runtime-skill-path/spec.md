## MODIFIED Requirements

### Requirement: A worker's installed skills track its currently-resolved runtime

A worker home's skills SHALL be installed under the skill path of the runtime that is actually resolved
for that agent at the time its home is rendered — never a runtime that was resolved on some earlier
render and has since gone stale. Each shipped skill SHALL be installed only for the agent kinds its
`skills/manifest.json` entry declares as its audience (`worker`, `weaver`, or `all` for both).

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
- **THEN** no skill whose `skills/manifest.json` audience is `weaver` is installed in that home
