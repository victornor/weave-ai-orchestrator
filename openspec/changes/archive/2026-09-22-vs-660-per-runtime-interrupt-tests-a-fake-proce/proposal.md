## Why

VS-657 (a message to a persistent session interrupts its running turn) introduced no new interrupt mechanism: `runs.cancel(..., 'interrupt', ...)` already stopped a turn via SIGINT to the process group with a 30 s SIGKILL backstop, and codex and opencode already had protocol-level interrupts (app-server `turn/interrupt`; serve `POST /session/:id/abort`). Its acceptance asked for one interrupt test per runtime adapter, using a fake process where needed. That task was not done: the repository has no shared per-adapter process harness, an interrupt test for the claude adapter does not exist, and the interrupt coverage that does exist (codex, opencode, weave, cursor) is bespoke to each adapter and does not uniformly assert that the turn stops and the partial events recorded before the cut are kept.

This change closes that gap with test-only work. It adds no mechanism and changes no adapter behaviour.

## What Changes

- Add a small, adapter-agnostic fake-process harness to `packages/runtime-sdk` (exported beside its existing `testkit`):
  - a scriptable fake executable that writes prepared stdout lines and then stays alive until signalled, with an optional flush-on-signal (lines plus exit code plus a marker recording which signal stopped it) and an ignore-SIGINT variant;
  - a `TurnSink` recorder and a wait helper;
  - an `interruptedTurn` driver that starts a turn through any adapter's `runTurn`, waits until the turn is genuinely under way, sends `cancel('interrupt')`, and returns the result and everything recorded.
- Add the missing **claude** interrupt test (signal-only) driven entirely by that harness.
- Route the existing **codex** (app-server `turn/interrupt`), **opencode** (serve `POST /session/:id/abort`) and **weave** (child aborts and flushes its result) interrupt tests through the same driver and recorder, and add the "partial events kept" assertion where it is missing. Their protocol stand-ins (the app-server JSON-RPC fake, the serve HTTP fake) stay as they are; only the test scaffolding around them is shared.
- Record in the PR body the plain list of runtimes and what each does on interrupt, naming gemini and cursor as signal-only and any adapter whose interrupt does not behave as the VS-657 plan claims. A defect found is reported and filed as its own ticket, never fixed here.
- No UI change.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

None. This is a test-only change: it adds a test harness and adapter test files and changes no adapter, server or UI behaviour.

## Impact

Test-only. `packages/runtime-sdk/src` gains one exported test-support module; `packages/runtimes/{claude,codex,opencode,weave}/test` gain or rework interrupt tests. No production path, schema, route, config or UI is touched. Verification iterates on the changed test files, then runs the full core/server and UI suites once with `--maxWorkers=4`, both blocks pasted verbatim in the PR.