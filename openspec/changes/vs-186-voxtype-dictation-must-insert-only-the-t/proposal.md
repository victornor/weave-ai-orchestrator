## Why

Captain, 2026-09-10: Voxtype dictation works, but `POST /api/transcribe` returns Voxtype's full stdout (`stdout.trim()`), so the composer received loading lines, sample counts, INFO logs, and a truncated preview plus the spoken sentence. Only the spoken sentence belongs there.

## What Changes

- When Voxtype transcribes, the text returned to the composer is **only** the spoken transcript. Loading lines, ANSI, INFO logs, `/tmp/ac-voxtype-*` paths, sample counts, and the truncated preview on the `Transcription completed` line are stripped.
- Chrome / Web Speech dictation is unchanged.
- A unit test feeds the captain's log fixture and asserts the composer-bound text is the last paragraph only.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `web-dictation/host-backend`: Voxtype host transcription SHALL insert only the spoken transcript into the composer, not the CLI's diagnostic stdout.

## Impact

- `packages/server/src/voxtype.ts` — parse Voxtype `transcribe` stdout before returning it as `{ text }`.
- `packages/server/test/voxtype.test.ts` — unit test with the 2026-09-10 log fixture (fake binary; never the host `voxtype`).
- `POST /api/transcribe` JSON shape is unchanged (`{ text }`). No Settings, Chrome path, Telegram, or TUI change. Live streaming stays out of scope.
