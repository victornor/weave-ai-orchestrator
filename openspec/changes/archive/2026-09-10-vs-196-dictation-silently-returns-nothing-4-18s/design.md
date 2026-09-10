## Context

See proposal.md for the incident and the full pipeline review. The short version: the temp WAV Voxtype decoded that day is gone (`voxtype.ts` deletes it unconditionally in a `finally`, and nothing logged its measured properties), so the one piece of evidence the ticket asks for cannot be produced retroactively. Guessing a capture-side fix without that evidence risks the same mistake VS-70/VS-121 already made twice on mobile dictation: a plausible-looking fix for a device-only bug that doesn't actually address what's wrong.

## Goals / Non-Goals

**Goals:**
- Make the next occurrence measurable: log the WAV's actual sample rate, channel count, bit depth, duration, peak amplitude and RMS for every Voxtype call, with the empty-result case logged loudly enough to find.
- Close the honest gap in acceptance criterion 4 regardless of cause: an empty Voxtype transcript must say so.

**Non-Goals:**
- Confirming root cause in this change. That requires a real measurement from a real occurrence, which does not exist yet.
- Changing `getUserMedia` capture constraints (e.g. disabling Chrome's default echo-cancellation/noise-suppression/AGC, a documented source of degraded capture on Linux/PipeWire hosts, and the leading hypothesis) speculatively. See Decisions.
- Retaining the raw audio bytes on disk. Numeric stats are sufficient evidence and avoid a data-retention question (recorded speech persisting on the host) that nothing here needs to answer.
- Changing Whisper/Voxtype decode parameters (explicitly out of scope per the ticket).

## Decisions

**Log numeric stats, don't retain audio.** The ticket asks for "duration, sample rate, channels, peak amplitude" — four (plus RMS, cheap to add) numbers computed from bytes already in hand in `voxtype.ts` before they're deleted. That's sufficient to distinguish "near-silent input" from "correctly-formatted, audible input" without keeping a copy of anyone's speech on the daemon host. Alternative considered: persist the WAV to a small ring-buffer diagnostics directory for direct playback/inspection. Rejected for this change — it is a real privacy trade-off (voice recordings persisting on disk, needing a retention/pruning policy) that is a deliberate call for the human, not something to decide unilaterally while chasing a transcription bug. If the numeric stats turn out to be ambiguous next time, that trade-off can be revisited with the human explicitly.

**Don't touch `getUserMedia` constraints yet.** Chrome's default audio constraints (`echoCancellation`/`noiseSuppression`/`autoGainControl`, all effectively `true` when a bare `audio: true` is requested) are a real, commonly-hit source of degraded or near-silent capture on Linux/PipeWire hosts — plausible here since the WAV's declared format is correct by construction and its duration matched, pointing at content rather than format. But the ticket is explicit: measure first, don't guess-fix. Once the new logging captures a low-peak-amplitude/near-silent WAV on a real recurrence, disabling those constraints for the upload-mode capture path (Voxtype does its own noise handling; it doesn't need the browser's) becomes a evidence-backed follow-up rather than a hopeful patch.

**Where the analyzer lives.** A pure function in `packages/server/src/voxtype.ts` (`analyzeWav(buffer): { sampleRate, channels, bitsPerSample, durationSec, peakAmplitude, rms } | null`) parsing the RIFF/`fmt `/`data` chunks and scanning 16-bit PCM samples. Returns `null` on anything that doesn't parse as a WAV rather than throwing — analysis failure must never block transcription. Logged via the existing `getLogger('http', { component: 'voxtype' })`, at `info` on every call and additionally at `warn` (with Voxtype's raw stdout tail, already captured) when the extracted transcript is empty.

## Risks / Trade-offs

- [Numeric stats alone might not be enough to fully diagnose the next occurrence — e.g. distinguishing "quiet but genuine speech" from "processed into noise" needs the waveform, not just peak/RMS] → Acceptable for this change: it is strictly more evidence than exists today (none), and confirms or rules out the "near-silent input" hypothesis directly. If it turns out to be inconclusive, that is itself new evidence for a follow-up decision (e.g. revisiting the retention trade-off above).
- [The new empty-transcript message could fire spuriously if a legitimate transcript is ever falsy for a reason other than "no words"] → `text` is only ever a trimmed string from `extractVoxtypeTranscript`; empty string is exactly and only the "no words recognized" case.
