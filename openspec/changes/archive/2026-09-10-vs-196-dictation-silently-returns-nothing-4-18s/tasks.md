## 1. Audio measurement in `voxtype.ts`

- [x] 1.1 Add `analyzeWav(buffer: Buffer)` to `packages/server/src/voxtype.ts`: parse the RIFF/`fmt `/`data` chunks for sample rate, channel count and bit depth, and compute duration (samples / sample rate), peak amplitude and RMS from the PCM payload (16-bit signed only; return `null` for anything else it can't parse). Verified with unit tests in `packages/server/test/voxtype.test.ts`: a synthetic silent WAV (peak/RMS ~0), a synthetic tone WAV (nonzero peak/RMS, correct duration), a stereo/48kHz header, and non-WAV/truncated bytes (`null`, no throw).
- [x] 1.2 In `transcribe()`, run `analyzeWav` on the received buffer before writing it to disk and log the result at `info` via the existing `getLogger('http', { component: 'voxtype' })`. When `extractVoxtypeTranscript` returns an empty string, additionally log at `warn` with the analysis plus Voxtype's raw stdout tail (already available as `r.stdout`). Verified with tests mocking `@agent-conductor/core`'s `getLogger`: `warn` fires with the 2026-09-10 degenerate-output fixture and does not fire on a normal non-empty transcript.

## 2. Empty-transcript message in the composer

- [x] 2.1 In `packages/ui/src/lib/dictation.ts`'s `postWav` success handler, when the response is ok and `json.text` is empty/whitespace-only, call `setError(...)` with a message telling the operator nothing was recognized and they can try again (matching the tone of the existing Chrome-mode `NO_TRANSCRIPT` message), instead of doing nothing. A non-empty `text` keeps handing off to `cb.current(json.text, true)` unchanged.
- [x] 2.2 Add a test in `packages/ui/src/test/dictation.test.tsx` covering: upload mode, `POST /api/transcribe` resolves 200 with `{ text: "" }` → the hook's `error` is set and `onText` is not called. Existing non-empty-transcript coverage stays green.

## 3. Spec and validation

- [x] 3.1 Confirm the delta at `specs/web-dictation/host-backend/spec.md` matches the shipped behavior (empty-Voxtype-transcript message; Chrome path unaffected).
- [x] 3.2 `pnpm lint && pnpm typecheck && pnpm test` green (2 pre-existing, unrelated flakes in `packages/core/src/jobs/jobs.test.ts` and `packages/core/src/runs/engine.test.ts` — both pass in isolation and touch no dictation/voxtype code; same shape as the known ULID/timestamp-tie flake in VS-191); `openspec validate vs-196-dictation-silently-returns-nothing-4-18s --strict` clean.
