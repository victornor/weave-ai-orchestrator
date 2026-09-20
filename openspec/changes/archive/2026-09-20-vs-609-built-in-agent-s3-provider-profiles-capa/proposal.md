## Why

S1 (VS-607) shipped the `weave` runtime with a minimal provider profile (`baseUrl`, `apiKeySecret`, `auth`, `headers`, `models`) and four option keys, and a codec that hard-codes `max_tokens`, `stream_options` and the `system` role. Real endpoints differ (Z.ai ignores `max_completion_tokens`, reasoning models reject sampling parameters, DeepSeek needs `reasoning_content` passed back, gateways retry-then-502). Adding a provider must be data, and every sampling and request parameter must be settable per provider, model, role and worker option, and never sent when unset.

## What Changes

- Full `providers` schema in workspace config: `preset`, `discover`, `modelsPath`, `maxConcurrentRuns`, `timeouts`, `compat` flags, `params`, and per-model `compat`/`params`. Pricing is not added (no cost display in v1).
- Compat flags applied by the codec: `maxTokensParam`, `omitParams`, `streamUsage`, `systemRole`, `reasoning.*`, `tools.*`, `strictAlternation`, `emptyContent`, `responseFormat`, `seedParam`, `stopMax` (`promptCache` is S6).
- A pure precedence resolver (preset < profile < model < role/worker option) producing the effective flags and parameters, in `packages/agent/src/profile.ts` / `codec/params.ts`.
- Option keys with range validation on the adapter's `configSchema`: `temperature`, `topP`, `frequencyPenalty`, `presencePenalty`, `maxOutputTokens`, `seed`, `stop` (`string[]`), `toolChoice`, `parallelToolCalls`, `responseFormat`, `extraBody` (JSON string), `extraHeaders` (`string[]`), `contextWindowTokens`.
- Presets (JSON) for thirteen providers plus generic, `verified: false` except flags proven by recorded captures (cheaper-inference, Z.ai, OpenRouter) which get fixtures from the real VS-605 bytes.
- Model discovery: `GET {baseUrl}{modelsPath}` merged with static models, 10-minute cache, survives 500 by falling back to static.
- `maxConcurrentRuns` semaphore in the adapter.
- `POST /providers/:id/test` route (runs the conformance probes, never on a schedule) and the conformance runner's CLI/probe cases; `docs/API.md`.
- Error mapping: 402 is quota; a gateway 5xx saying "routes failed after N attempts" is not retried without a cap.

## Capabilities

### New Capabilities
- none

### Modified Capabilities
- `builtin-agent`: adds requirements for provider profiles, capability flags, parameter precedence, model discovery and connection testing.

## Impact

`packages/shared/src/config.ts`, `packages/agent` (`presets/`, `profile.ts`, `codec/`, `conformance.ts`), `packages/runtimes/weave` (`adapter.ts`, `child.ts`), `packages/server` (route, wiring), `docs/API.md`, design docs in the knowledge base. No new dependencies. Protocol v1 `init.provider` grows additive fields (`compat`, `params`).
