## 1. Model verification

- [x] 1.1 Export `namedModel` from `packages/runtimes/cursor/src/args.ts` so `adapter.ts` can reuse the exact "what model, if any, was requested" resolution `buildArgs` already uses, rather than re-deriving it.
- [x] 1.2 In `packages/runtimes/cursor/src/adapter.ts`, add a family-word extractor (first alphabetic run of the requested model id, lowercased) and a match check against the `model` field carried on the parsed `session.started`/`session.resumed` event. Skip the check entirely when no named model was requested (`auto`/unset).
- [x] 1.3 On a mismatch, interrupt the run (`cancel('interrupt')`) as soon as it's detected and return a `TurnResult` with `error: { code: 'model_mismatch', family: 'tooling', message }` naming both the requested and reported model. Do not set `timedOut` (would overwrite the specific error code in `finalize()`).
- [x] 1.4 Update `test/fakeCli.ts`'s `writeFakeCursorCli` to report back whatever `--model` argv value it was actually given (default `Auto` when absent) instead of the fixed `'fake-model'` string, so it behaves like a correctly-functioning CLI for the existing named-model test.
- [x] 1.5 Add a test (`test/adapter.test.ts` or `test/liveInput.test.ts`) with a fake CLI that reports a *different* model family than requested (e.g. requested `grok-4-6`, fake CLI reports `Claude 4.5 Opus High Thinking`) and assert the turn fails with `error.code === 'model_mismatch'`. Add/keep a test confirming `model: 'auto'` never triggers the check regardless of what's reported.

## 2. Fail fast on silence

- [x] 2.1 In `runTurn`, track whether any stdout/stderr line has been seen since spawn. Start a grace timer (local constant, e.g. 20s, capped at `input.limits.timeoutMs`, overridable in tests via `input.options['noOutputGraceMs']`) that interrupts the process and marks a `no_output` failure if nothing has arrived when it fires.
- [x] 2.2 Return `TurnResult` with `error: { code: 'no_output', family: 'tooling', message }` on that path, again without setting `timedOut`.
- [x] 2.3 Add a fake CLI variant (or a `test/fakeCli.ts` option) that spawns and never writes anything to stdout or stderr, and never exits on its own. Test that `runTurn` (with a short `noOutputGraceMs` override) resolves with `error.code === 'no_output'` well within the test's own timeout, and that the process is actually gone afterward.
- [x] 2.4 Confirm the existing fast-completing fake-CLI tests (`auto`, named model, oversized prompt) are unaffected — the grace timer never fires when output arrives immediately.

## 3. Verify

- [x] 3.1 Run `pnpm typecheck`, `pnpm lint`, and `pnpm test` at the repo root. No live `cursor-agent` invocation anywhere — fake CLI and scratch config only, per the standing rule.
