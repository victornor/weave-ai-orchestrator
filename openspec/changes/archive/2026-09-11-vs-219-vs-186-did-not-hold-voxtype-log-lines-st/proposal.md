## Why

VS-186's noise filter did not hold. Captain, 2026-09-11: the composer again received Voxtype's log lines above the dictated words. The filter is anchored at `^`, but Voxtype 1.0.1's real log lines begin with an ISO-8601 timestamp (`2026-09-11T02:03:05.793763Z  INFO Using local whisper transcription mode`), so the level word is never at position 0 and every timestamped line — including the `Transcription completed` line that quotes the transcript — survives into the composer.

## What Changes

- The daemon runs one-shot dictation as `voxtype -q … transcribe <wav>`. Verified on the host (voxtype 1.0.1): `-q` suppresses every timestamped `INFO`/`WARN` line, so the failure class disappears by construction instead of by pattern-matching.
- The stdout filter remains as a justified residual, narrowed to output actually observed: the three progress lines `-q` still prints (`Loading audio file:`, `Audio format:`, `Processing N samples (…)`), plus timestamped and bare log-level lines as a safety net if `-q` ever stops suppressing them. No guessed shapes.
- Tests are rewritten against verbatim captured output: a 2026-09-11 host capture of `voxtype --model large-v3-turbo transcribe` (timestamps, ANSI, degenerate-empty transcript, trailing blank lines) and the captain's verbatim 2026-09-11 incident lines — not hand-written approximations.
- Chrome / Web Speech dictation, the VS-196 empty-transcript warning, and the `info models --json` model-list path are unchanged.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `web-dictation/host-backend`: the "Voxtype transcription inserts only the spoken transcript" requirement now pins (a) host transcription runs with `-q` so timestamped log lines never reach stdout, and (b) extraction verified against the 2026-09-11 timestamped capture, not the untimestamped 2026-09-10 fixture alone.

## Impact

- `packages/server/src/voxtype.ts` — `transcribe()` args gain `-q`; `DIAGNOSTIC_LINE` gains an ISO-timestamped log-line branch. `status()` / model-list path untouched.
- `packages/server/test/voxtype.test.ts` — verbatim 2026-09-11 fixtures (quoted provenance); argv assertion for `-q`; existing 2026-09-10 / VS-196 fixtures kept as bare-level regressions.
- `POST /api/transcribe` JSON shape unchanged (`{ text }`). No Settings, Chrome, Telegram, or TUI change. Host dependency: voxtype ≥ 1.0.1 for `-q` (the installed host version); if `-q` ever stops suppressing, the widened filter still keeps logs out of the composer.
