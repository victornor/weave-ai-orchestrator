## Context

See proposal.md for motivation. `createVoxtypeProbe().transcribe` (`packages/server/src/voxtype.ts:87`) writes the upload to a temp wav, runs `voxtype [--model <id>] transcribe <path>`, and returns `r.stdout.trim()`. Voxtype 1.0.1 writes diagnostic lines to stdout (not only stderr), so `{ text }` from `POST /api/transcribe` is logs plus the transcript. The composer (`useDictation` upload mode) inserts that string as-is. Chrome / Web Speech never hits this path.

Captain paste (2026-09-10) is the contract fixture: loading / format / samples / INFO lines including a truncated `Transcription completed in …: "…"` preview, then a blank line, then the full spoken paragraph.

## Goals / Non-Goals

**Goals:**

- One pure extractor on Voxtype stdout so `{ text }` is the spoken transcript.
- Unit-test it with the captain fixture and with clean stdout (today's fake binary).
- Keep the existing Chrome path and the yaml `command` provider path untouched.

**Non-Goals:**

- Live streaming / partials.
- Telegram / TUI.
- Changing CLI flags (`--quiet`, JSON) as the primary fix — production must still be correct if Voxtype keeps logging to stdout.
- Client-side stripping in the composer.
- Treating empty-after-strip as a hard failure (empty text is better than logs; non-zero exit still throws).

## Decisions

### Strip on the server, in `voxtype.ts`

Export `extractVoxtypeTranscript(raw: string): string` and apply it in `transcribe()` before return. `POST /api/transcribe` stays `{ text }`. The composer needs no change.

*Alternatives considered.* Strip in the UI after fetch: every upload caller would have to remember, and the API would keep lying. Rejected. Ask Voxtype for quiet/JSON: not a documented contract we can unit-test against the captain fixture, and a quiet flag would hide the bug until the next verbose default. Optional extra later; not this ticket.

### Line filter after ANSI strip, not "last paragraph"

1. Strip ANSI CSI/OSC sequences.
2. Drop lines that are diagnostics: `Loading audio file:`, `Audio format:`, `Processing … samples`, log-level prefix (`INFO` / `WARN` / `DEBUG` / `ERROR`, optional ANSI already gone), and `Transcription completed`.
3. Join remaining lines, trim. Blank lines between diagnostics collapse away.

This keeps a multi-sentence / multi-line transcript and still works if Voxtype later prints only the transcript (no diagnostics → identity). "Last non-empty paragraph" would drop a leading spoken paragraph if the speaker paused; the captain paste happens to be one paragraph.

*Alternatives considered.* Take only the last paragraph: matches this one paste, fails if the spoken text itself has a blank line. Rejected. Regex-extract the quoted preview on `Transcription completed`: that preview is truncated (`pretty coo...`). Rejected.

### Fixture lives in the voxtype unit test

`packages/server/test/voxtype.test.ts`: (1) call `extractVoxtypeTranscript` on the captain stdout (and ANSI-wrapped INFO, transcript-only). (2) fake binary that prints that fixture; `transcribe()` returns the spoken paragraph. Existing `ok:base.en` fake stays so clean stdout still works. Never spawn host `voxtype` or talk to `voxtype.service`.

## Risks / Trade-offs

- [Spoken text that itself starts with `INFO ` would be dropped] → Dictation of log lines is vanishingly rare; prefer dropping logs over inserting them. Accept.
- [Voxtype changes log format] → Filter is prefix/shape based on the recorded fixture, not a full CLI grammar. A future format that puts the transcript on an INFO line would yield empty text rather than logs; empty is the safer failure.
- [Empty transcript after strip] → Composer gets `""` and the operator can type. Non-zero exit still errors. Do not fall back to the truncated preview.

## Migration Plan

None. Rollback is revert. No config or schema change.

## Open Questions

None.
