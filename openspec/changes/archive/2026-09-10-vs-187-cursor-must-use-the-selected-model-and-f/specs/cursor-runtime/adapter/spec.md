## MODIFIED Requirements

### Requirement: Models are listed without spending tokens

`listModels` SHALL return a static list of Cursor CLI model ids the adapter maintains, matching the documented live catalog for the CLI this repo targets (including `auto` and the frontier aliases the host's `cursor-agent` picker shows: Grok 4.6, Opus 5, 5.6, Fable 5.1, plus the `--model` help examples). It SHALL NOT spawn `cursor-agent` to list models. `describeAccount`, if implemented, SHALL NOT spawn the CLI and SHALL NOT spend model tokens. `readCredential`, if implemented, SHALL read the credential file only and SHALL never return a token.

`buildArgs` SHALL pass `--model <id>` only when the resolved model is a non-empty string other than `auto`. An unset model, an empty model, or `auto` SHALL omit `--model` so the CLI chooses.

A turn requesting a named model (not `auto`, not unset) SHALL compare that model against the model `cursor-agent` reports on its `system`/`init` line once the session starts. The comparison SHALL be family-word based (the requested id's first alphabetic run, matched case-insensitively as a substring of the reported model) rather than exact-string, since the CLI's reported string is a free-form display name not pinned by this adapter. When the reported model does not contain the requested model's family word, the adapter SHALL interrupt the turn and SHALL report a `TurnResult.error` with code `model_mismatch` rather than completing as an ordinary success. A turn requesting `auto` or no model SHALL NOT be subject to this check.

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

#### Scenario: The CLI ran the requested model family

- **WHEN** a turn requests model `opus-5` and `cursor-agent`'s `system.init` line reports a model string containing "Opus"
- **THEN** the turn is not interrupted for a model mismatch
- **AND** it can complete as an ordinary success

#### Scenario: The CLI silently ran a different model

- **WHEN** a turn requests model `grok-4-6` and `cursor-agent`'s `system.init` line reports a model string that does not contain "grok" (for example a Claude/Opus display name)
- **THEN** the adapter interrupts the turn
- **AND** the returned `TurnResult.error.code` is `model_mismatch`

#### Scenario: Auto is exempt from the model check

- **WHEN** a turn requests model `auto` (or no model at all)
- **THEN** no model-mismatch check runs regardless of what `system.init` reports

## ADDED Requirements

### Requirement: A silent process fails within seconds, not the full daemon watchdog window

`runTurn` SHALL track whether `cursor-agent` has written any line to stdout or stderr since it was spawned. If no such line has arrived within a short, adapter-local grace period — comfortably under the daemon's own `defaults.silenceTimeoutSec` floor — the adapter SHALL interrupt the process itself and SHALL report a `TurnResult.error` with code `no_output`, rather than relying solely on the daemon supervisor's generic silence watchdog (which defaults to 600 seconds).

#### Scenario: A completely silent spawn fails fast

- **WHEN** `cursor-agent` spawns and writes nothing at all to stdout or stderr before the adapter's own no-output grace period elapses
- **THEN** the adapter interrupts the process
- **AND** the returned `TurnResult.error.code` is `no_output`
- **AND** this happens well before the daemon's `silenceTimeoutSec` (minimum 60s, default 600s) would have fired

#### Scenario: Any output at all defers to normal completion

- **WHEN** `cursor-agent` writes at least one line to stdout or stderr before the grace period elapses
- **THEN** the no-output check never interrupts the turn
- **AND** the turn proceeds to its normal outcome
