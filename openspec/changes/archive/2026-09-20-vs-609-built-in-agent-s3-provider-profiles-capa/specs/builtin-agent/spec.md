## Purpose
Provider profiles, capability flags, presets, parameter precedence, model discovery and connection testing for the built-in `weave` agent, so any OpenAI-compatible endpoint works by data.

## ADDED Requirements

### Requirement: Parameters resolve by precedence and unset ones are never sent
The agent SHALL resolve request flags and parameters from the layers preset, provider profile, model entry, then the role or worker option, a higher layer replacing a lower one field by field. A parameter no layer sets SHALL NOT appear in the request body, and any name in `omitParams` SHALL NOT appear even when `extraBody` supplies it.

#### Scenario: Precedence
- **WHEN** the preset sets `temperature` 0.2, the model entry sets 0.5 and the worker option sets 0.9
- **THEN** the request carries `temperature: 0.9`

#### Scenario: Unset and omitted
- **WHEN** no layer sets `topP` and `omitParams` lists `temperature`
- **THEN** the body contains neither `top_p` nor `temperature`

### Requirement: Compat flags shape the request
The codec SHALL honour `maxTokensParam`, `streamUsage`, `systemRole`, `reasoning.effortParam`/`effortMap`, `reasoning.passBack`, `tools.parallel`, `tools.choice`, `tools.strict`, `tools.idFormat`, `strictAlternation`, `emptyContent`, `responseFormat`, `seedParam` and `stopMax`.

#### Scenario: Output cap name
- **WHEN** `maxTokensParam` is `max_tokens` and `maxOutputTokens` is 100
- **THEN** the body has `max_tokens: 100` and no `max_completion_tokens`

#### Scenario: Reasoning pass-back
- **WHEN** a profile sets `reasoning.passBack: reasoning_content`
- **THEN** assistant tool-step messages of the current turn carry `reasoning_content` and earlier turns do not

### Requirement: Providers are data
A provider defined only by a YAML profile (preset, base URL, secret, flags) SHALL run a turn with no code change.

#### Scenario: YAML profile turn
- **WHEN** a profile parsed from YAML points at a mock endpoint
- **THEN** a mock turn completes through it

### Requirement: Option keys are validated
The `weave` adapter's `configSchema` SHALL declare `temperature`, `topP`, `frequencyPenalty`, `presencePenalty`, `maxOutputTokens`, `seed`, `stop`, `toolChoice`, `parallelToolCalls`, `responseFormat`, `extraBody`, `extraHeaders` and `contextWindowTokens`, and `validateRuntimeOptions` SHALL reject out-of-range values.

#### Scenario: Out of range
- **WHEN** `temperature` is 3 or `topP` is -1
- **THEN** validation fails naming the key

### Requirement: Models list themselves
`listModels` SHALL merge the profile's static models with `GET {baseUrl}{modelsPath}` results, cache discovery for 10 minutes per provider, and return the static list when discovery fails.

#### Scenario: Discovery 500
- **WHEN** the endpoint answers 500
- **THEN** `listModels` returns the static models and does not throw

### Requirement: Concurrency and quota mapping
The adapter SHALL hold at most `maxConcurrentRuns` concurrent child runs per provider. An HTTP 402 SHALL map to family `provider_quota`, and a gateway 5xx body saying routes failed after N attempts SHALL NOT be retried beyond a single retry.

#### Scenario: 402
- **WHEN** the endpoint answers 402
- **THEN** the turn ends with `provider_quota`

### Requirement: Providers can be tested on demand
`POST /providers/:id/test` SHALL run the conformance probes against the named provider using its secret and return a per-capability verdict; it SHALL run only when requested.

#### Scenario: Test route
- **WHEN** a client posts to the route for a configured provider with a mock endpoint
- **THEN** the response lists each probe with ok/detail
