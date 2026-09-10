## MODIFIED Requirements

### Requirement: Models are listed without spending tokens

`listModels` SHALL enumerate Cursor CLI's real, currently accepted model ids by invoking
`cursor-agent --list-models` and parsing its output into `RuntimeModel[]`, tagging each entry
`source: 'detected'`. This SHALL NOT start a model session, run a turn, or otherwise spend
model/LLM tokens — `--list-models` exits without producing assistant output. A successful result
SHALL be cached in the adapter's process and reused for calls within a bounded freshness window,
so a caller rendering a model picker repeatedly does not respawn the CLI on every render. `auto`
SHALL always be present in the returned list, added if the CLI's own output omitted it.

When `cursor-agent` is not on PATH, the `--list-models` call fails, times out, exits non-zero, or
its output cannot be parsed into at least one model id, `listModels` SHALL make exactly one attempt
(no retry, no second detection path) and SHALL then return a static fallback list of ids known to
have been valid as of this change (tagged `source: 'static'`) rather than returning an empty list
or throwing. Every returned id, from either path, SHALL be one `cursor-agent` actually accepts as
of the source it came from — no id SHALL be invented or hand-guessed. Every returned entry SHALL
carry a human-readable `label` distinct from its raw `id`.

Falling back SHALL be logged at `warn` with the reason (missing binary, non-zero exit, timeout, or
unparseable output) and a bounded excerpt of whatever `cursor-agent` printed, so the difference
between a live-detected catalogue and a stale fallback is reachable by a human reading the daemon
log rather than only present in the `source` field. The excerpt SHALL NOT include credentials.

`describeAccount`, if implemented, SHALL NOT spawn the CLI and SHALL NOT spend model tokens.
`readCredential`, if implemented, SHALL read the credential file only and SHALL never return a
token.

`buildArgs` SHALL pass `--model <id>` only when the resolved model is a non-empty string other
than `auto`. An unset model, an empty model, or `auto` SHALL omit `--model` so the CLI chooses.

A turn requesting a named model (not `auto`, not unset) SHALL compare that model against the model
`cursor-agent` reports on its `system`/`init` line once the session starts. The comparison SHALL
be family-word based (the requested id's first alphabetic run, matched case-insensitively as a
substring of the reported model) rather than exact-string, since the CLI's reported string is a
free-form display name not pinned by this adapter. When the reported model does not contain the
requested model's family word, the adapter SHALL interrupt the turn and SHALL report a
`TurnResult.error` with code `model_mismatch` rather than completing as an ordinary success. A
turn requesting `auto` or no model SHALL NOT be subject to this check.

When a turn fails because `cursor-agent` rejected the requested model outright (a message of the
form "Cannot use this model: `<id>`. Available models: `<list>`", where `<list>` may end in a
truncated `, ...`), the adapter SHALL parse the available-models list out of that message and
SHALL include it in the returned `TurnResult.error.message`, so the human sees the CLI's own
current catalogue rather than only the id that failed.

#### Scenario: listModels does not spawn

- **WHEN** `listModels` is called again before its previously cached result has expired
- **THEN** it returns that previous result (whether detected or fallback)
- **AND** no new `cursor-agent` process is started

#### Scenario: A cold cache detects the live catalog

- **WHEN** `listModels` is called with no cached result (or an expired one) and `cursor-agent
  --list-models` succeeds
- **THEN** the returned list is parsed from that output
- **AND** every entry's `source` is `detected`
- **AND** `auto` is present even if the CLI's own output did not include it

#### Scenario: Detection fails and the fallback answers instead

- **WHEN** `cursor-agent` is not on PATH, or `--list-models` exits non-zero, times out, or its
  output has no parseable model id
- **THEN** `listModels` returns the static fallback list
- **AND** every entry's `source` is `static`
- **AND** the returned list is never empty
- **AND** exactly one detection attempt was made — no retry, no second detection path

#### Scenario: A fallback is logged, not silent

- **WHEN** detection fails for any reason
- **THEN** a `warn`-level log records the reason and a bounded excerpt of the CLI's actual output
- **AND** the logged excerpt contains no credential

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

- **WHEN** a turn requests model `opus-5` and `cursor-agent`'s `system.init` line reports a model
  string containing "Opus"
- **THEN** the turn is not interrupted for a model mismatch
- **AND** it can complete as an ordinary success

#### Scenario: The CLI silently ran a different model

- **WHEN** a turn requests model `grok-4-6` and `cursor-agent`'s `system.init` line reports a
  model string that does not contain "grok" (for example a Claude/Opus display name)
- **THEN** the adapter interrupts the turn
- **AND** the returned `TurnResult.error.code` is `model_mismatch`

#### Scenario: Auto is exempt from the model check

- **WHEN** a turn requests model `auto` (or no model at all)
- **THEN** no model-mismatch check runs regardless of what `system.init` reports

#### Scenario: A rejection surfaces the real catalogue

- **WHEN** a turn fails with a message reading `Cannot use this model: grok-4-6. Available
  models: auto, gpt-5.2, cursor-grok-4.6-high-fast, ...` (a truncated list)
- **THEN** the returned `TurnResult.error.message` includes the parsed available ids
  (`auto`, `gpt-5.2`, `cursor-grok-4.6-high-fast`)
- **AND** parsing the trailing `, ...` does not throw or produce a bogus `"..."` entry

## ADDED Requirements

### Requirement: Model ids get a derived human-readable label

Every `RuntimeModel` this adapter returns SHALL carry a `label` derived algorithmically from its
`id` (its family word plus any recognized variant/tier suffix), not from a hand-maintained
id-to-label table. This SHALL apply equally to ids from `--list-models` and from the static
fallback, so a model id neither list's author anticipated still reads as something recognizable
rather than as a raw id.

#### Scenario: A known id reads as its brand name

- **WHEN** the id is `cursor-grok-4.6-high-fast`
- **THEN** the derived label contains "Grok 4.6"

#### Scenario: An unrecognized id still gets a readable label

- **WHEN** the id is one `--list-models` reports that matches no known family word
- **THEN** the derived label is a humanized form of the id (not the raw id string, and not empty)
