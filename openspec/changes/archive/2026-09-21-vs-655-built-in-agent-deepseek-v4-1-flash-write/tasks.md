## 1. Detection and failure

- [x] 1.1 Add `packages/agent/src/textToolCalls.ts` with `detectTextToolCalls(text)` for the DSML markers, and `stopError.textToolCalls` / `stopError.toolsUnsupported` in `errors.ts`. Verify: unit tests with a DSML fixture quoted from the VS-639 run, plain prose, and text quoting a marker without `invoke`.
- [x] 1.2 In `loop.ts`, fail a step that would end the turn with no structured calls when tools were offered and the text is detected. Verify: a loop test against `testkit/mockProvider` with a DSML reply fails on the old code and now returns `text_tool_calls`/`tooling` with no tool run. (Acceptance 1, 2.)
- [x] 1.3 In `loop.ts`, fail at start with `tools_unsupported` when compat declares tools unsupported and the tool list is non-empty. Verify: a loop test asserts the mock provider got zero requests.
- [x] 1.4 Prove an unopted provider never executes text: a loop test with DSML text naming `bash` asserts no bash execution and a `tooling` error. (Acceptance 2.)

## 2. Docs and hand-off

- [x] 2.1 Document the two codes and the owner's `debugWire` capture command in `docs/running-the-agent-yourself.md`. Verify: `packages/shared/src/tools.test.ts` still passes.
- [x] 2.2 Post the capture command and what was not run against the live provider as a ticket comment; run the full suite once with `--maxWorkers=4`.
