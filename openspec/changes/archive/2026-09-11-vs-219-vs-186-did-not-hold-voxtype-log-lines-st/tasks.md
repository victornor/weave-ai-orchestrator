## 1. Quiet invocation and observed-shape filter

- [x] 1.1 In `packages/server/src/voxtype.ts` `transcribe()`, spawn `voxtype` with `-q` before the subcommand: `['-q', '--model', model, 'transcribe', wav]` / `['-q', 'transcribe', wav]`. Verify with a fake binary that echoes argv: with and without a model, `-q` precedes `--model`/`transcribe`. `status()` args are untouched.

- [x] 1.2 Extend `DIAGNOSTIC_LINE` with an ISO-8601-timestamped log-line branch (`YYYY-MM-DDTHH:MM:SS[.ffffff]Z` + spaces + level), keeping every existing branch. Verify `extractVoxtypeTranscript` against verbatim captures (copied from this change's `captures/`, provenance in comments): `2026-09-11-no-flags.stdout` (timestamps, ANSI, degenerate-empty transcript, trailing blanks) → `''`; `2026-09-11-quiet.stdout` (three progress lines + blanks) → `''`; the captain's 2026-09-11 paste (four timestamped lines, the last quoting `I got another idea and I think it would be interes…`) → `''`; the existing 2026-09-10 and VS-196 fixtures still extract exactly as before.

- [x] 1.3 Verify `transcribe()` end to end with a fake binary: stdout = verbatim quiet capture plus a spoken paragraph (marked as captured-noise + arbitrary words) → returns the paragraph only. The VS-196 empty-transcript warning test keeps passing unchanged, and the model-list tests (`parseVoxtypeModelsJson`, `status()`) are untouched.

## 2. Checks

- [x] 2.1 `pnpm lint && pnpm typecheck && pnpm test` all green; post the actual output on the ticket. No test spawns host `voxtype` or touches `voxtype.service`.
