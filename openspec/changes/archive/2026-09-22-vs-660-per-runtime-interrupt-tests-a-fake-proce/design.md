## Context

See `proposal.md` for the motivation. Every runtime adapter spawns through `spawnLines` (`packages/runtime-sdk/src/process.ts`), which already implements the shared primitive: `cancel('interrupt')` ends stdin, signals the whole process group with SIGINT, and schedules a SIGKILL backstop 30 s later. `packages/runtime-sdk/src/process.test.ts` tests that primitive directly. What is missing is the layer above it: proof that each *adapter's* interrupt path is wired to that primitive, and that a cut turn keeps the events recorded before the cut.

The current per-adapter state:

- **claude** — `cancel` is `run.cancel(mode)` directly. `test/fakeCli.ts` exists but has no hang/signal mode, and no test cancels a claude turn.
- **codex** — app-server mode sends `turn/interrupt` and then `proc.cancel(mode)` (`src/app-server.ts`). `test/appServerFake.ts` has a `hang` scenario and `test/app-server.test.ts` already cancels it.
- **opencode** — serve mode sends `POST /session/:id/abort` and then `proc.cancel(mode)` (`src/serve.ts`). `test/fake-opencode.mjs` has `FAKE_HANG` and `test/serve-turn.test.ts` already cancels it.
- **weave** — `cancel` aborts the concurrency-gate wait and cancels the child (`src/adapter.ts`). The child's `bin.ts` aborts on SIGINT/SIGTERM and flushes a result with `exitCode 143`; `test/fake-agent.mjs` models this and `test/adapter.test.ts` cancels it, but asserts only the result, not the kept events.
- **gemini**, **cursor** — signal-only: `cancel` is `run.cancel(mode)`. cursor has an incidental interrupt test through its no-output grace; gemini has none.

So the mechanism is proven at the primitive, and four adapters have partial, bespoke coverage. This change supplies the missing shared harness and makes the four adapter tests uniform.

## Goals / Non-Goals

**Goals:**

- One small, reusable fake-process harness that any adapter test can drive `cancel('interrupt')` through.
- Four adapter-level interrupt tests (claude, codex, opencode, weave), each asserting both that the interrupt stopped the turn and that the events/partials recorded before the cut are still there.
- Each test fails if that adapter's interrupt path is removed.
- A fifth adapter test needs no new scaffolding.
- No adapter behaviour change.

**Non-Goals:**

- No change to `spawnLines`, to any adapter's `cancel`, or to the engine's finalize/`interrupted_by_message` handling.
- No fix for a defect a test exposes; such a defect is reported and filed as its own ticket.
- No test for gemini or cursor beyond naming them signal-only in the PR (cursor already has an incidental one; the required four are claude, codex, opencode, weave).
- No UI or documentation change.

## Decisions

### Decision 1 — The harness lives in `runtime-sdk`, exported beside `testkit`

Adapter tests in `packages/runtimes/*/test` reach the SDK only through `@weave-ai/runtime-sdk`, whose `index.ts` is the wiring point (vitest aliases `@weave-ai/*` to each package's `src/index.ts`). The SDK already ships test support there (`testkit.ts`), owns the process spawner, and owns `TurnHandle`/`TurnSink` — the types the harness records. A new `packages/runtime-sdk/src/fakeProcess.ts`, exported from `index.ts`, is the smallest place a cross-package test harness can live. It imports only `node:fs`/`node:os`/`node:path` plus SDK types, so it adds nothing runtime-detectable.

### Decision 2 — Three pieces: a fake process, a recorder, and a driver

1. `writeFakeProcess(spec)` writes an executable Node script into a fresh temp dir and returns its path plus a marker path. Spec: `name` (the basename an adapter resolves), `lines` (stdout lines written on start), `delayMs` (gap between them), `hang` (stay alive until signalled), `onInterrupt` (`{ lines?, exitCode?, marker? }`: flush these lines, record which signal arrived, then exit), and `ignoreSigint` (survive SIGINT, for escalation cases). This is the stand-in for a *process* adapter and covers claude and weave (weave uses the same file as its `entry`, run by `node`).
2. `recordSink()` returns a real `TurnSink` and the arrays it fills (events, partials, raw, spawns).
3. `interruptedTurn(adapter, input, { until })` starts `adapter.runTurn`, waits until `until(recorded)` is true (default: at least one event or partial), captures the handle from `onHandle`, calls `handle.cancel('interrupt')`, and returns `{ result, recorded, handle }`.

The driver is protocol-agnostic: it knows only `RuntimeAdapter.runTurn`, `TurnHandle.cancel` and `TurnSink`. The protocol stand-ins for codex (JSON-RPC) and opencode (HTTP) remain their existing dedicated fakes, which the driver cannot and need not replace.

### Decision 3 — "Stops the turn" is asserted through a signal marker, not Node's signal semantics

A fake that never exits on its own (a `setInterval` keeps it alive) exits only because the interrupt reached it. Each test asserts the turn *resolved* (the driver returned) and, for the signal-only adapters, that the fake's marker names SIGINT: its SIGINT handler records the signal and exits, so the assertion is deterministic across platforms and does not depend on how Node reports a default-handled signal to the parent. For codex the marker is the fake's request log (a `turn/interrupt` line with the turn id); for opencode it is the serve fake's request log (a `POST /session/<id>/abort` line).

### Decision 4 — "Fails if the interrupt path is removed" is a property of the harness, not extra tests

Because every fake stays alive without a signal:

- removing claude's/weave's `cancel` call leaves `run.done` unresolved and the test times out;
- removing codex's `turn/interrupt` request still lets `proc.cancel` kill it, so the *log assertion* is what fails (the signal path is a fallback, not the interrupt);
- removing opencode's `abortSession()` still lets `proc.cancel` kill it, so the abort-request assertion fails.

The tests assert the mechanism each adapter claims, so weakening either half is caught.

### Decision 5 — "Kept as recorded" is asserted against the sink after the cut

Each test snapshots which event types (and, for partial-capable adapters, which partial texts) arrived before `cancel`, then asserts they are still present in the recorded arrays after the turn resolves. This is the engine-visible contract VS-657 relies on: the recorded events up to the cut remain the turn's transcript.

### Decision 6 — Reuse: a fifth adapter needs only a spec

The two signal-only required tests (claude, weave) use the same `writeFakeProcess` with different specs and the same driver; codex and opencode use the same driver and recorder with their protocol fakes. A further adapter that resolves its CLI from the run environment (claude, codex, opencode, cursor and weave all do, directly or through `launchCommand`) needs only a `writeFakeProcess` spec plus the driver. **gemini is the exception**: its adapter passes the bare command to `spawnLines`, which resolves it with `whichSync(process.env.PATH)` rather than the run environment, so a gemini test would additionally have to pin the process PATH — a fact to state in the PR rather than claim as free.

### Decision 7 — Protocol stand-ins are reused, not rewritten

`test/appServerFake.ts` and `test/fake-opencode.mjs` already model their protocols, including the hang and the interrupt reply. Rewriting them under a generic fake would either lose protocol fidelity or grow the harness into a protocol emulator, which is not "the smallest" anything. The harness standardises the *driver and recorder*; the protocol fakes stay adapter-local.

### Decision 8 — A defect is reported, never fixed here

If a test shows an adapter's interrupt does not behave as VS-657's Decision 2/Risks claim (for example a runtime that does not stop, or partials lost), the finding goes in the PR and files as its own ticket. This change's diff stays test-only; fixing adapter behaviour would need its own spec-level change.

## Risks / Trade-offs

- **[A fake that hangs forever makes a failing test hang rather than fail]** → `interruptedTurn` and `waitFor` take a bounded `timeoutMs` and reject with the recorded state, so a missing interrupt fails in seconds with a readable reason.
- **[Cancelling before the turn is under way takes the `cancelledTurn` path and never reaches the protocol step]** → the `until` predicate waits for the adapter's own evidence (an event, a partial, or a logged request) before cancelling; codex/opencode assert the protocol line, which only exists once the turn started.
- **[Signal semantics differ across platforms]** → the marker is written by the fake's own handler, not inferred from `close(code, signal)`.
- **[Rewriting existing codex/opencode/weave tests could destabilise green coverage]** → the change to them is mechanical (swap their hand-rolled sink/loop for the shared recorder/wait/driver) and each keeps its existing assertions, with the "kept events" assertion added.
- **[A harness bug makes every adapter test pass wrongly]** → a `fakeProcess` unit test proves the fake emits its lines, stops on SIGINT with the marker, and that `interruptedTurn` times out when no interrupt is delivered.

## Migration Plan

No migration. Test-only files on the ticket's branch; rollback is reverting the commit. No deploy step beyond the normal merge.