## 1. Schema, resolver, flags, presets (part a)
- [x] 1.1 Extend `ProviderProfileSchema`/`ProviderModelSchema` in `packages/shared/src/config.ts` (preset, discover, modelsPath, maxConcurrentRuns, timeouts, compat, params, per-model compat/params)
- [x] 1.2 Pure precedence resolver in `packages/agent/src/profile.ts` + `codec/params.ts`, with a precedence table test
- [x] 1.3 Codec applies every compat flag; per-flag request-body tests and mock-provider flag matrix
- [x] 1.4 Preset JSON for the thirteen providers plus generic, load/validate test, `verified` tags
- [x] 1.5 Fixtures from the real VS-605 captures (sanitised, provenance notes) and flag tests for cheaper-inference, Z.ai, OpenRouter
- [x] 1.6 Adapter option keys in `configSchema` with range validation; `validateRuntimeOptions` test; init carries resolved compat/params
- [x] 1.7 YAML-profile-only mock turn test; 402 quota and capped gateway-5xx retry tests

## 2. Discovery, concurrency, conformance, route (part b)
- [x] 2.1 `listModels` discovery merge, 10-minute cache, 500 fallback, `modelContextWindow`
- [x] 2.2 `maxConcurrentRuns` semaphore in the adapter
- [x] 2.3 Conformance runner CLI and probe cases (captures outside the repo)
- [x] 2.4 `POST /providers/:id/test` route with test, `docs/API.md`
- [x] 2.5 Update knowledge design docs; run lint, typecheck and each full suite once (`--maxWorkers=4`)
