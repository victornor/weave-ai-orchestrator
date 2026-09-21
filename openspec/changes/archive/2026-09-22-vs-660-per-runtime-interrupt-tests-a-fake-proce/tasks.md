## 1. The reusable harness

- [x] 1.1 Add `packages/runtime-sdk/src/fakeProcess.ts` exporting `writeFakeProcess` (scriptable fake executable: prepared stdout lines, hang-until-signal, optional flush-on-signal with exit code and a signal marker, ignore-SIGINT variant), `recordSink` (a real `TurnSink` plus the events/partials/raw/spawns it fills), `waitFor` (bounded polling), and `interruptedTurn` (starts any adapter's `runTurn`, waits until the turn is under way, calls `cancel('interrupt')`, returns result and recording). Export it from `packages/runtime-sdk/src/index.ts` beside `testkit`. Verify it typechecks and builds.
- [x] 1.2 Add a `fakeProcess` unit test proving the property every adapter test depends on: the fake writes its prepared lines, stops on SIGINT writing the signal marker, and `interruptedTurn` rejects on its bounded timeout when the adapter's `cancel` does not reach the fake. Verify the test passes.

## 2. Claude (signal)

- [x] 2.1 Add `packages/runtimes/claude/test/interrupt.test.ts`: a fake `claude` on `PATH` emits a `system:init` line and then hangs; `cancel('interrupt')` ends the turn, the fake's marker names SIGINT, and the `session.started` event recorded before the cut is still present. Verify the test passes, and that it fails (times out) if the adapter's `cancel` is removed.

## 3. Codex (app-server `turn/interrupt`, then signal)

- [x] 3.1 Rework the codex app-server interrupt test in `packages/runtimes/codex/test/app-server.test.ts` to use `recordSink`/`waitFor`/`interruptedTurn` with the existing `writeFakeAppServer('hang')` stand-in; keep the `turn/interrupt` request assertion with the turn id and add the assertion that the partial text recorded before the cut is still present. Verify the test passes.

## 4. OpenCode (serve `POST /session/:id/abort`, then signal)

- [x] 4.1 Rework the opencode interrupt test in `packages/runtimes/opencode/test/serve-turn.test.ts` to use the shared recorder/wait/driver with the existing `fake-opencode.mjs` `FAKE_HANG` stand-in; keep the abort-request assertion and add the assertion that partials recorded before the cut are still present. Verify the test passes.

## 5. Built-in weave runtime (abort and flush)

- [x] 5.1 Add `packages/runtimes/weave/test/interrupt.test.ts`: the same `writeFakeProcess` file used as the adapter's `entry` emits a `turn.started` event and then hangs, flushing a `result` with `exitCode 143` on SIGINT; `cancel('interrupt')` ends the turn with that flushed result and the `turn.started` event recorded before the cut is still present. Verify the test passes, and that it fails (times out) if the adapter's `cancel` is removed.

## 6. Runtime list and verification

- [x] 6.1 Record in the PR body the plain list of runtimes and what each does on interrupt — claude and weave signal the process group (weave's child aborts and flushes its result), codex app-server sends `turn/interrupt` then signals, opencode serve posts `session/:id/abort` then signals, gemini and cursor are signal-only — and the reuse statement: a fifth adapter that resolves its CLI from the run environment needs only a `writeFakeProcess` spec plus the shared driver, while gemini resolves from the daemon's own PATH and would additionally pin it. Name any adapter whose interrupt does not behave as the VS-657 plan claims, and if a real defect was found, file it as its own ticket rather than fixing it here.
- [x] 6.2 Iterate on the changed test files, then run one full suite with `--maxWorkers=4`; paste the core/server and UI suite blocks verbatim in the PR.