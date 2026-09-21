## MODIFIED Requirements

### Requirement: Standalone operation and configuration sources

The REPL SHALL run with no daemon and no workspace, from any directory. Provider profiles SHALL come from, in order, `--provider`/`--base-url` flags, the user's `agent.yaml` (`$XDG_CONFIG_HOME/weave/agent.yaml`, else `~/.config/weave/agent.yaml`), then the daemon's `daemon.yaml` in its config directory. A provider in a workspace's `workspace.yaml` SHALL be ignored; the nearest workspace SHALL contribute MCP servers only. A provider key SHALL be resolved first hit wins: the profile's own `apiKey` (a literal, or a `${NAME}`/`{env:NAME}` reference read from the environment), then the environment name in the profile's `apiKeySecret` or `WEAVE_LLM_<PROVIDER>_KEY`, then the daemon's encrypted secret store read locally, else, on a terminal, a hidden in-memory prompt. A workspace secret store SHALL NOT contribute a provider key. No `--api-key` flag SHALL exist. A literal `apiKey` SHALL be honoured only in the user's own `agent.yaml`. A key SHALL NOT appear in argv, output, logs, `--debug` output, session files, the bash tool's environment or any error or validation message; only the user's own `agent.yaml` may hold a literal key.

#### Scenario: Environment key, scratch home

- **WHEN** the REPL runs with a scratch `HOME`, no workspace and `WEAVE_LLM_<PROVIDER>_KEY` set, and completes a turn
- **THEN** the request carries the key, and the key appears in no argv, terminal output or session file

#### Scenario: Workspace provider

- **WHEN** the nearest workspace defines a provider and neither the user's `agent.yaml` nor `daemon.yaml` defines it
- **THEN** the REPL does not use that provider

#### Scenario: Literal key in the user config, any directory

- **WHEN** the REPL runs from a directory with no workspace above it, a scratch `HOME`/`XDG_CONFIG_HOME` holds an `agent.yaml` whose provider sets a literal `apiKey`, and a turn completes against a mock endpoint
- **THEN** the request carries the key as its bearer, and the key appears in no stdout, stderr, argv, session file or `--verbose` transcript

#### Scenario: Literal key in a workspace config is refused

- **WHEN** the nearest `workspace.yaml` sets a literal `apiKey` on a provider
- **THEN** that provider is ignored along with the whole workspace provider block, no part of the value is read, and no part of it appears in output or a session file

#### Scenario: The daemon's provider and key are used

- **WHEN** only `daemon.yaml` defines a provider, its key is in the daemon secret store, and no user `agent.yaml` exists
- **THEN** the REPL uses that provider and key without contacting the daemon
