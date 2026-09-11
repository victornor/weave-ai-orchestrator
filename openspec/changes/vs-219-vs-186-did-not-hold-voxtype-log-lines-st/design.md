## Context

VS-186 added `extractVoxtypeTranscript` with a filter anchored at `^`, tested against a fixture whose log lines begin with the level word. Voxtype 1.0.1's real lines begin with an ISO-8601 timestamp, so the anchor never matches. This ticket re-grounded the design in captured output before proposing anything. All captures below are from this host, 2026-09-11, voxtype 1.0.1 (`/usr/bin/voxtype`), one-shot `transcribe` on a 2.0 s 16 kHz mono wav, stdout/stderr captured to files (non-TTY, exactly how the daemon spawns it).

**Capture A — `voxtype --model large-v3-turbo transcribe` (no flags), stdout, ANSI-stripped for readability; raw bytes carry ANSI (`ESC[2m` around the timestamp, `ESC[32m` around ` INFO`):**

```
Loading audio file: "/tmp/opencode/vs219/tone.wav"
Audio format: 16000 Hz, 1 channel(s), Int
Processing 32000 samples (2.00s)...
2026-09-11T02:10:53.635895Z  INFO Using local whisper transcription mode
2026-09-11T02:10:53.635907Z  INFO Loading whisper model from "/home/user/.local/share/voxtype/models/ggml-large-v3-turbo.bin"
2026-09-11T02:10:53.936088Z  INFO Model loaded in 0.30s
2026-09-11T02:10:54.050790Z  WARN Whisper returned degenerate transcript "." for 2.00s audio; retrying with beam search
2026-09-11T02:10:54.166277Z  WARN Whisper retry also returned degenerate transcript "."; treating as empty
2026-09-11T02:10:54.166289Z  INFO Transcription completed in 0.23s: ""
<blank>
<blank>
```

The spoken paragraph would follow the blank lines (empty here: a tone transcribes degenerate, which reproduces the VS-196 shape). stderr carried only whisper.cpp init noise.

**Capture B — same command with `-q`:** stdout is only

```
Loading audio file: "/tmp/opencode/vs219/tone.wav"
Audio format: 16000 Hz, 1 channel(s), Int
Processing 32000 samples (2.00s)...
<blank>
<blank>
```

**Captain's incident paste (2026-09-11, verbatim in VS-219):** four timestamped lines (`INFO Using local whisper transcription mode`, `INFO Loading whisper model from …ggml-large-v3-turbo.bin`, `INFO Model loaded in 0.59s`, `INFO Transcription completed in 1.21s: "I got another idea and I think it would be interes…"`) reached the composer above the dictated words.

Mechanism facts established by these captures:

1. **No machine-readable mode exists for `transcribe`.** `voxtype transcribe --help` offers only `--engine`. `--format json` exists only on `status` (daemon status). `--file-path` is ignored by one-shot `transcribe` (verified: no file produced).
2. **Logs are already on stdout**, the transcript's stream; stream separation buys nothing. Only whisper.cpp init noise goes to stderr.
3. **`-q` (quiet, errors only) suppresses every timestamped log line** but still prints the three progress lines.

## Goals / Non-Goals

**Goals:**

- The composer receives only the spoken words, for Voxtype's *actual* output shapes.
- The primary fix removes the noise by construction (`-q`), not by pattern-guessing.
- Fixtures are verbatim captured bytes with quoted provenance.

**Non-Goals:**

- Changing `POST /api/transcribe` shape, the Chrome path, Settings, the model-list path, or the VS-196 empty-transcript warning.
- Requiring a specific voxtype version at runtime beyond what `-q` needs (1.0.1 is installed; no version gate).

## Decisions

### 1. Run dictation with `-q` — the by-construction fix

`transcribe()` args become `['-q', '--model', model, 'transcribe', wav]` (global args precede the subcommand; order verified working on 1.0.1). Capture B proves the timestamped lines — the exact class that defeated VS-186 — never reach stdout.

*Alternatives considered.* **JSON output mode:** does not exist for `transcribe` (fact 1). **Logs to stderr:** false premise — they are already on stdout (fact 2). **Widen the anchor only:** this is the third version of the same guess; the first two were written against assumed shapes and the second one is the bug being fixed. Rejected as the sole fix. VS-186's design rejected `-q` because "production must still be correct if Voxtype keeps logging to stdout" — decision 2 keeps that property.

### 2. Keep a text filter as the residual — justified last resort

`-q` alone fails acceptance criterion 1: the three progress lines survive it (Capture B). The filter therefore stays, but every branch is now grounded in captured bytes:

- `Loading audio file:`, `Audio format:`, `Processing … samples …` — the three progress lines, observed in Captures A and B (and unchanged by `-q`).
- ISO-timestamped log line (`2026-09-11T02:10:53.635895Z  INFO …`) — Capture A / captain paste. This branch is the safety net if `-q` ever stops suppressing (voxtype upgrade, flag rename): the composer stays clean, one version of the guess instead of three.
- Bare log-level prefix and untimestamped `Transcription completed` — kept unchanged; the existing 2026-09-10 and VS-196 fixtures are kept as regressions for that shape (they are real captured output per their own provenance comments, and prove the two shapes coexist across versions/conditions).

ANSI stripping and CR normalization stay (Capture A proves ANSI on stdout in this exact path).

### 3. Fixtures are verbatim captures with quoted provenance

`packages/server/test/voxtype.test.ts` gains the raw bytes of Capture A (timestamps, ANSI, degenerate-empty transcript, trailing blanks) and Capture B, each with a comment naming command, date, version, and input. The captain's 2026-09-11 paste is asserted verbatim. The fabricated-transcript hybrid (`-q` stdout + a spoken paragraph) is allowed only for asserting preservation, marked as such. Never spawn host `voxtype` in tests — provenance comments carry the evidence instead.

### 4. Accept that `-q` hides voxtype's own degenerate-transcript WARN

Under `-q`, the WARN lines in Capture A disappear from stdout, so the VS-196 empty-transcript warning attaches progress lines instead of voxtype's explanation. Our warning still fires (it keys on extracted text being empty, unchanged), and `analyzeWav` already logs the measured audio. Accepted: correct output in the composer outranks a richer server-side log line.

## Risks / Trade-offs

- [voxtype older than `-q` support] → Unknown-flag error exits non-zero, dictation fails loudly rather than inserting logs. 1.0.1 is the installed host version; accepted.
- [Voxtype changes output shapes again] → `-q` makes the primary path shape-independent; the filter covers both observed log shapes. A third shape would yield log lines in the composer again — the failure mode is bounded and visible, which is what got this fixed twice.
- [Spoken text starting with `INFO ` or matching a progress phrase] → Pre-existing accepted risk from VS-186, unchanged in kind: a dictated first line like "Loading audio file: …" would be dropped. Vanishingly rare against dictation traffic.

## Migration Plan

None. Rollback is revert. No config, schema, or API change.

## Open Questions

None.
