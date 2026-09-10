## ADDED Requirements

### Requirement: Voxtype transcription inserts only the spoken transcript

When Voxtype transcribes audio for the web composer, the text that lands in the composer SHALL be only the spoken transcript. It SHALL NOT include Voxtype CLI loading lines, audio-format or sample-count lines, ANSI, INFO (or other log-level) lines, `/tmp/ac-voxtype-*` paths, or the truncated preview on a `Transcription completed` line. Selecting Chrome SHALL keep the existing Chrome dictation path unchanged.

#### Scenario: Composer receives the spoken sentence only

- **WHEN** Voxtype stdout is the 2026-09-10 fixture (loading the temp wav, audio format, sample count, INFO whisper lines including a truncated `Transcription completed` preview, then a blank line and the full spoken paragraph)
- **THEN** the text returned for the composer is that spoken paragraph only, with no `/tmp/ac-voxtype-*` path, no sample counts, and no INFO lines

#### Scenario: Clean stdout is unchanged

- **WHEN** Voxtype stdout is already only the spoken transcript
- **THEN** that transcript is returned as-is

#### Scenario: Chrome dictation path unchanged

- **WHEN** the dictation backend is Chrome
- **THEN** tapping the microphone still uses Chrome / Web Speech and does not send audio to the daemon
