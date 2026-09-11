## MODIFIED Requirements

### Requirement: Voxtype transcription inserts only the spoken transcript

When Voxtype transcribes audio for the web composer, the text that lands in the composer SHALL be only the spoken transcript. The daemon SHALL invoke the one-shot `voxtype transcribe` command with quiet output so timestamped log lines never reach the stdout it reads. The returned text SHALL NOT include Voxtype CLI loading lines, audio-format or sample-count lines, ANSI, ISO-8601-timestamped or bare log-level lines, `/tmp/ac-voxtype-*` paths, or the truncated preview on a `Transcription completed` line. Extraction SHALL be verified against Voxtype's real captured output, not a hand-written approximation. Selecting Chrome SHALL keep the existing Chrome dictation path unchanged.

#### Scenario: Composer receives the spoken sentence only

- **WHEN** Voxtype stdout is the 2026-09-10 fixture (loading the temp wav, audio format, sample count, untimestamped INFO whisper lines including a truncated `Transcription completed` preview, then a blank line and the full spoken paragraph), or the 2026-09-11 host capture of `voxtype --model large-v3-turbo transcribe` whose log lines begin with ISO-8601 timestamps and carry ANSI
- **THEN** the text returned for the composer is the spoken paragraph only — with no `/tmp/ac-voxtype-*` path, no sample counts, no INFO or WARN lines, and no ISO timestamps — and the 2026-09-11 capture, whose transcript is degenerate-empty, yields empty text rather than any log line

#### Scenario: Host transcription runs Voxtype with quiet output

- **WHEN** the daemon transcribes audio with Voxtype on the host
- **THEN** the spawned arguments request quiet output (`-q` before the `transcribe` subcommand), and stdout that still contains only the three progress lines Voxtype prints even under `-q` (loading, audio format, sample count) yields no log content in the composer

#### Scenario: Clean stdout is unchanged

- **WHEN** Voxtype stdout is already only the spoken transcript
- **THEN** that transcript is returned as-is

#### Scenario: Chrome dictation path unchanged

- **WHEN** the dictation backend is Chrome
- **THEN** tapping the microphone still uses Chrome / Web Speech and does not send audio to the daemon
