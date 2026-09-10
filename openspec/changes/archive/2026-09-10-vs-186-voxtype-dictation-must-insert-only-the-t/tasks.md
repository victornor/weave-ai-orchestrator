## 1. Extract transcript from Voxtype stdout

- [x] 1.1 Add `extractVoxtypeTranscript(raw: string): string` in `packages/server/src/voxtype.ts` per design.md (strip ANSI, drop loading/format/samples/log-level/`Transcription completed` lines, trim). Verify in `packages/server/test/voxtype.test.ts`: the 2026-09-10 captain fixture returns only the spoken paragraph; transcript-only stdout is unchanged; ANSI-wrapped INFO lines are dropped.

- [x] 1.2 Apply the extractor in `transcribe()` before returning stdout. Verify a fake `voxtype` binary that prints the captain fixture yields that spoken paragraph from `probe.transcribe()`, and the existing clean-stdout fake (`ok:base.en`) still returns `ok:base.en`. Never spawn the host `voxtype`.

## 2. Checks

- [x] 2.1 Run `pnpm lint && pnpm typecheck && pnpm test` and confirm all are green. Chrome dictation tests still pass; no test talks to `voxtype.service`.
