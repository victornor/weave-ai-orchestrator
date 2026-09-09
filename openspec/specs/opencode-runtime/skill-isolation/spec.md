# opencode-runtime/skill-isolation Specification

## Purpose
Stops an OpenCode worker turn from loading the host user's personal skill directories, so coding tickets do not pay for bailian, omarchy, and other host skills on every request.

## Requirements

### Requirement: OpenCode turns do not inherit host HOME skill directories

When the daemon launches an OpenCode turn with a workspace runtime `configHome`, the child process `HOME` SHALL be that `configHome` (the same directory already used for `XDG_CONFIG_HOME` and `XDG_DATA_HOME`). The spawn SHALL NOT leave `HOME` pointing at the host user. Skills available to the turn SHALL be the AgentConductor-installed set in the agent home (`.opencode/skills`), not skills discovered from the host's `~/.agents` or `~/.claude` directories.

#### Scenario: HOME is the runtime config home

- **WHEN** `buildArgs` is given `configHome` for an OpenCode turn
- **THEN** the spawn env sets `HOME` to that `configHome`
- **AND** `XDG_CONFIG_HOME` and `XDG_DATA_HOME` remain that same directory

#### Scenario: Host skills are not on the search path

- **WHEN** an OpenCode worker turn runs with `configHome` set
- **THEN** the child's `HOME` is not the host user's home
- **AND** host skill directories under the host user's `~/.agents` and `~/.claude` are not the child's skill search path

### Requirement: Other adapters that inherit host HOME for skills are isolated the same way

Any shipped runtime adapter that currently spreads the host environment without overriding `HOME`, and whose CLI discovers extra skills from `$HOME`, SHALL set `HOME` to its runtime `configHome` when that value is present, the same way OpenCode does. Adapters that already isolate skill discovery through a dedicated config-dir env var and do not load host HOME skill dirs SHALL be left unchanged.

#### Scenario: An adapter that leaks host HOME is patched

- **WHEN** a shipped adapter other than OpenCode is found to load skills from the host `$HOME`
- **THEN** its spawn env sets `HOME` to `configHome` when `configHome` is set

#### Scenario: An already-isolated adapter is unchanged

- **WHEN** a shipped adapter already points skill discovery at a dedicated config-dir env var and does not load host HOME skill dirs
- **THEN** this change does not alter that adapter's `HOME`
