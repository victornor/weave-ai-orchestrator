## 1. Make the tool surface visible

- [x] 1.1 Emit `tools.offered` from the child loop (protocol event, adapter passthrough) with a test on `loop.test.ts`
- [x] 1.2 Reproduce with a scripted fake provider: a worker-shaped init (Weave MCP server stub, `outputSchema`) asserts the request `tools` contain `weave_*` and `submit_result`; write it so it fails on the current code if the defect is in the child, and the child passes: it offers `weave_*` and `submit_result` on first and resumed turns, so the defect is not in the child's tool assembly

## 2. Fix the cause and guard the start

- [ ] 2.1 Fix the defect the reproduction (or a codec/compat check against the codeify profile shape) exposes; no permission loosening, no new tools
- [x] 2.2 Child ends the turn with `tools_missing` when `submit_result` or the Weave tool set is absent; tests for both scenarios

## 3. Empty turns

- [x] 3.1 Engine records an empty worker turn (owed report, none returned, no evidence, acting status) as failed `empty_turn`; test including the `in_review` non-case
- [x] 3.2 Supervisor stops `liveness_repair` after two consecutive empty runs, raises the gate finding once, and resumes on human/weaver wake; tests

## 4. Verify

- [ ] 4.1 Run changed test files, then one full `pnpm test` with `--maxWorkers=4`; paste both suite blocks
- [ ] 4.2 End-to-end on a real weave-runtime worker ticket with the codeify provider if it can be run without live credentials from the ticket; otherwise state it as unverified and why
- [ ] 4.3 Comment the outcome on VS-639 when this lands
