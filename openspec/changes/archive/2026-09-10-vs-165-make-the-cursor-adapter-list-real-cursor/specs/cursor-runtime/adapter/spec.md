## MODIFIED Requirements

### Requirement: Turns run locally through cursor-agent print mode

A turn on runtime `cursor` SHALL spawn `cursor-agent` through `launchCommand` in the agent's existing cwd (the daemon-provided home / worktree). The invocation SHALL use non-interactive print mode (`-p` / `--print`) with `--output-format stream-json`, `--trust` and `--force` (or `--yolo`). The prompt SHALL be an argv operand after `--` when it fits the argv budget, or closed plain-text stdin when oversized. The spawn SHALL NOT keep stdin open for NDJSON `user` frames. File edits SHALL land in that cwd. The spawn SHALL NOT use ACP (`cursor-agent acp`) and SHALL NOT start `cursor-agent worker`.

#### Scenario: A new turn

- **WHEN** a worker on runtime `cursor` takes a first turn
- **THEN** the child command is `cursor-agent`
- **AND** the args include `-p` (or `--print`) and `--output-format stream-json`
- **AND** the args include `--trust` and `--force` or `--yolo`
- **AND** cwd is the daemon-provided agent home
- **AND** the prompt is an argv operand after `--` (or closed plain-text stdin when oversized)
- **AND** stdin is not an NDJSON `user` frame

#### Scenario: ACP is not the integration path

- **WHEN** a turn is launched
- **THEN** the args do not contain `acp`

#### Scenario: A private cloud worker is not started

- **WHEN** a turn is launched
- **THEN** the args do not contain `worker`

### Requirement: A human's message reaches the executing turn on open stdin

Runtime `cursor` SHALL declare `streamingInput: false` and SHALL NOT expose `TurnHandle.send`. A cursor turn SHALL ignore workspace `defaults.liveInput` and SHALL NOT keep the child's stdin open. A human message sent while a cursor turn is executing SHALL queue for the next turn under the existing `agent-attach/live-input` contract for a runtime that does not offer a live channel.

The adapter SHALL NOT prefix the prompt with `&`.

#### Scenario: The prompt is the first stdin frame

- **WHEN** `buildArgs` runs for a cursor turn
- **THEN** the prompt is an argv operand after `--` (or closed plain-text stdin when oversized)
- **AND** stdin is not an NDJSON `user` frame
- **AND** the args do not include `--continue`, `acp`, or `worker`

#### Scenario: A mid-turn send is delivered

- **WHEN** a turn is executing on runtime `cursor` and a human sends text to that agent
- **THEN** the handle has no `send`
- **AND** the outcome is a queued next-turn wake, not mid-turn delivery

#### Scenario: Stdin closes on the result line

- **WHEN** a cursor turn is launched
- **THEN** stdin is already closed (or never opened as a live channel)
- **AND** the handle has no `send`

#### Scenario: Live input can be turned off

- **WHEN** the turn is launched with `liveInput: false` or with the workspace default `liveInput: true`
- **THEN** the handle has no `send`
- **AND** the prompt is still an argv operand or closed plain-text stdin, not an NDJSON `user` frame

### Requirement: Models are listed without spending tokens

`listModels` SHALL return a static list of Cursor CLI model ids the adapter maintains, matching the documented live catalog for the CLI this repo targets (including `auto` and the frontier aliases the host's `cursor-agent` picker shows: Grok 4.6, Opus 5, 5.6, Fable 5.1, plus the `--model` help examples). It SHALL NOT spawn `cursor-agent` to list models. `describeAccount`, if implemented, SHALL NOT spawn the CLI and SHALL NOT spend model tokens. `readCredential`, if implemented, SHALL read the credential file only and SHALL never return a token.

`buildArgs` SHALL pass `--model <id>` only when the resolved model is a non-empty string other than `auto`. An unset model, an empty model, or `auto` SHALL omit `--model` so the CLI chooses.

#### Scenario: listModels does not spawn

- **WHEN** `listModels` is called
- **THEN** it returns a non-empty static list
- **AND** no `cursor-agent` process is started
- **AND** the list includes `auto` and the documented live aliases (Grok 4.6, Opus 5, 5.6, Fable 5.1)

#### Scenario: Credential facts carry no token

- **WHEN** `readCredential` is called on a config home that holds `auth.json`
- **THEN** the result is `{ present, expiresAt }` with no token-bearing field

#### Scenario: Auto omits --model

- **WHEN** `buildArgs` runs with model `auto` or with no model
- **THEN** the args do not contain `--model`

#### Scenario: A named model is forwarded

- **WHEN** `buildArgs` runs with a named model id from the catalog other than `auto`
- **THEN** the args include `--model` and that id
