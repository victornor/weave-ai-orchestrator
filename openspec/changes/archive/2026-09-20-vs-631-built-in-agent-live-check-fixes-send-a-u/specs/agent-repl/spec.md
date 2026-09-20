## MODIFIED Requirements

### Requirement: The REPL is installed with the CLI and runs the existing loop
`weave repl` and a `weave-agent` command SHALL start an interactive session on the built-in agent's loop, with the same tools, permission modes, compaction, skills, MCP client and steering queue a daemon turn has. The `weave-agent` command SHALL be written next to `weave` by every path that writes the `weave` shim, so it is on PATH after an upgrade. An upgrade SHALL apply the new release's own shim list on the upgrade that introduces a shim, by running that release's writer after `current` flips, so a shim a release adds appears on the first upgrade to it. `--help` SHALL work from the installed path.

#### Scenario: A prompt is answered
- **WHEN** a prompt is entered against a provider that streams text and then a tool call
- **THEN** the streamed text and a compact rendering of the tool call and its result appear, and a session file exists afterwards

#### Scenario: Installed shim
- **WHEN** `writeCliShims` runs for a release that has a CLI build
- **THEN** both `weave` and `weave-agent` shims exist, executable, and `weave-agent --help` prints the REPL's usage

#### Scenario: A shim introduced by the new release is written on that upgrade
- **WHEN** an upgrade runs from a release whose shim list does not name `weave-agent` to one that does
- **THEN** `weave-agent` exists next to `weave` afterwards, pointing at the new release's REPL entry

### Requirement: Standalone operation and configuration sources
The REPL SHALL run with no daemon and no workspace, from any directory. Provider profiles SHALL come from, in order, `--provider`/`--base-url` flags, the nearest workspace's `providers`, then the user's `agent.yaml` (`$XDG_CONFIG_HOME/weave/agent.yaml`, else `~/.config/weave/agent.yaml`). A provider key SHALL be resolved first hit wins: the profile's own `apiKey` (a literal, or a `${NAME}`/`{env:NAME}` reference read from the environment), then the environment name in the profile's `apiKeySecret` or `WEAVE_LLM_<PROVIDER>_KEY`, then the workspace secret store read locally, else, on a terminal, a hidden in-memory prompt. No `--api-key` flag SHALL exist. A literal `apiKey` SHALL be honoured only in the user's own `agent.yaml`; the same field in a workspace's `workspace.yaml` SHALL be rejected with a one-line message naming the field and telling the person to use `apiKeySecret` or the environment. A key SHALL NOT appear in argv, output, logs, `--debug` output, session files, the bash tool's environment or any error or validation message; only the user's own `agent.yaml` may hold a literal key.

#### Scenario: Environment key, scratch home
- **WHEN** the REPL runs with a scratch `HOME`, no workspace and `WEAVE_LLM_<PROVIDER>_KEY` set, and completes a turn
- **THEN** the request carries the key, and the key appears in no argv, terminal output or session file

#### Scenario: Workspace provider
- **WHEN** a workspace with a provider and a stored secret resolves from the working directory
- **THEN** that provider and key are used without contacting the daemon

#### Scenario: Literal key in the user config, any directory
- **WHEN** the REPL runs from a directory with no workspace above it, a scratch `HOME`/`XDG_CONFIG_HOME` holds an `agent.yaml` whose provider sets a literal `apiKey`, and a turn completes against a mock endpoint
- **THEN** the request carries the key as its bearer, and the key appears in no stdout, stderr, argv, session file or `--verbose` transcript

#### Scenario: Literal key in a workspace config is refused
- **WHEN** the nearest `workspace.yaml` sets a literal `apiKey` on a provider
- **THEN** that provider is skipped with a one-line message naming the field and pointing at `apiKeySecret` or the environment, and no part of the value appears

## ADDED Requirements

### Requirement: A skipped provider profile says why, without the value
When a provider profile in a config file fails validation and is skipped, and that provider is the one requested, the REPL SHALL state in one line the file, the provider and the failing field, and SHALL NOT include any part of the field's value. Skip reasons SHALL be printed whenever the chosen provider is the one skipped, not only under `--verbose`.

#### Scenario: A key pasted into a secret-name field
- **WHEN** `agent.yaml` sets `apiKeySecret` to a key-shaped value such as `sk-test-abc123`, so the provider is skipped, and that provider is requested
- **THEN** the message names the file, the provider and `apiKeySecret`, explains it must be a secret name such as `WEAVE_LLM_<PROVIDER>_KEY`, and contains no part of `sk-test-abc123`

#### Scenario: A skipped provider that was not requested
- **WHEN** a different provider is requested and another one is skipped
- **THEN** the request proceeds and the skipped provider's reason is not printed

### Requirement: A plaintext credential in a readable user config is warned about
When the user's `agent.yaml` is readable by group or others and holds a plaintext credential — a literal `apiKey`, or an `apiKeySecret` that is not a valid secret name — the REPL SHALL print one line naming the file's mode and `chmod 600 <file>`, SHALL NOT print the value, and SHALL still run. If the REPL ever creates `agent.yaml` it SHALL create it with mode 0600.

#### Scenario: Group-readable file with a literal key
- **WHEN** `agent.yaml` has mode 0644 and a provider sets a literal `apiKey`
- **THEN** the REPL prints one line with the mode and `chmod 600 <file>`, does not print the key, and the turn still runs

#### Scenario: Private file
- **WHEN** the same file has mode 0600
- **THEN** no warning is printed

### Requirement: A first run shows a minimal config
With no provider configured, `weave repl` SHALL print a short how-to containing a minimal working `agent.yaml` — a provider with `baseUrl`, a literal `apiKey`, a `models` list, and `provider`/`model` defaults — and SHALL say the file is used from any directory. It SHALL not send a request.

#### Scenario: Nothing configured
- **WHEN** `weave repl -p "hi"` runs with no provider from flags, workspace or `agent.yaml`
- **THEN** it exits 2, prints the minimal-config example naming `~/.config/weave/agent.yaml`, and sends no request

### Requirement: One-shot mode reads a context window and keeps its streams separate
`weave repl` SHALL accept `--context-window <tokens>`, a positive whole number of tokens, and use it as the run's `contextWindowTokens` for the session's turns; an invalid value SHALL be refused with a note and no turn started. The loop's unknown-context-window warning SHALL name the flag. In `-p` mode stdout SHALL carry only the final text, and every `--verbose` event line SHALL go to stderr.

#### Scenario: Flag set
- **WHEN** `weave repl --base-url <url> --context-window 128000 -p "<prompt>"` runs
- **THEN** the run's provider options carry `contextWindowTokens` 128000, and no unknown-context-window warning is logged

#### Scenario: Flag refused
- **WHEN** `--context-window 0` or a non-number is passed
- **THEN** it is refused with a note and the turn is not started

#### Scenario: Streams
- **WHEN** `-p` runs with `--verbose`
- **THEN** stdout is exactly the final text and the rendered events appear only on stderr