## 1. Errors and retry
- [x] 1.1 `errors.ts` classification table (moved from the codec) with real-byte fixtures under `packages/agent/fixtures/errors/`, one per row; `max_steps`/`output_truncated` family `tooling`
- [x] 1.2 `retry.ts`: backoff with jitter, `Retry-After` seconds/date, caps, deadline awareness; fake-timer tests
- [x] 1.3 Connect, idle (comments reset), request timeouts; mid-stream drop retry; wire into `loop.ts`
## 2. Repair and guards
- [x] 2.1 `repair.ts` argument repair and the `invalid` corrective path; three-strikes stop
- [x] 2.2 `doom.ts` guard; step, deadline, budget stops; `finish_reason: length` recovery
- [x] 2.3 SSE and assembler edge cases (missing id, duplicate index, no `[DONE]`, comments, torn events)
## 3. debugWire, adapter, chaos suite, docs
- [x] 3.1 `debugWire` capture with redaction and a no-secret test; option key in the adapter `configSchema`
- [x] 3.2 Adapter carries `retryAfterMs` and codes through; test
- [x] 3.3 Chaos suite with fake timers (dropped stream, stall, 429 storm, torn JSON, duplicate index, missing id)
- [x] 3.4 Update the builtin-agent knowledge docs (error table, `max_steps` family); lint, typecheck, each full suite once with `--maxWorkers=4`
