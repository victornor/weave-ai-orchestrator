## Why

Captain dictated 4.18s of real speech through the composer's Voxtype (host-backend) path and got nothing back: Voxtype decoded it to `"."` twice (greedy, then its own beam-search retry) and gave up. The composer showed nothing and explained nothing — indistinguishable from the feature being broken. Investigation (below) establishes what can and cannot be confirmed from the evidence that exists today, and closes the loop so the *next* occurrence is diagnosable instead of another guess.

## Investigation findings

The full capture pipeline was read end to end: `packages/ui/src/lib/dictation.ts` (`getUserMedia` → `AudioContext` + `ScriptProcessorNode` → `Float32Array` chunks), `packages/ui/src/lib/wav.ts` (linear-interpolation downsample to 16 kHz + 16-bit PCM mono WAV encode), the `POST /transcribe` route (`packages/server/src/routes/daemon.ts`), and `packages/server/src/voxtype.ts` (writes the received bytes to a temp `.wav`, shells out to `voxtype transcribe`, deletes the file in a `finally`, unconditionally).

What the evidence supports:
- Voxtype's own log line reports the WAV it decoded was 4.18s long. That duration is computed by Voxtype from the file's own header/sample count, and it matches a real ~4.18s recording — so the capture path did run for the right duration; this was not a near-instant or zero-length file (which would be the signature of the `AudioContext` failing to start, or the `ScriptProcessorNode` never being wired up).
- The WAV handed to Voxtype is always produced by our own encoder at a fixed 16 kHz mono 16-bit PCM, by construction (`encodePcm16MonoWav(downsampleTo16k(samples, pcmRate.current), 16000)`), so the header format itself (declared sample rate, mono) cannot be the “wrong format” failure mode the ticket asks to rule out first, unless the resample/encode step is skipped entirely — and the matching duration argues it was not.
- Nothing in the capture, resample, multipart-parsing, or file-write code contains a logic bug that would explain wholesale signal loss: no truncation, no channel-count mismatch introduced by our code, no obviously wrong header field.

What the evidence does **not** cover, and cannot be reconstructed after the fact: the actual measured sample rate/channel count/peak amplitude/RMS of the specific bytes Voxtype decoded that day. `voxtype.ts` deletes the temp WAV unconditionally in its `finally` block and today logs nothing about the audio's measured properties — only Voxtype's own stdout/stderr on a non-zero exit code, which this call did not have (Voxtype exited 0 having decided the transcript was empty). So the one piece of hard evidence the ticket asks for — the measured properties of the audio actually handed to the model — was never captured and no longer exists for this specific incident.

This is the same shape of problem the team has hit before with device-only bugs (mobile dictation duplication, VS-121): reasoning from a reconstructed sequence produced two blind, failed fixes before a real capture settled it. The same discipline applies here. Rather than guess at a capture-side fix (e.g. Chrome's default echo-cancellation/noise-suppression/AGC processing is a real, documented source of degraded capture on Linux/PipeWire hosts, and is one plausible candidate) or declare this an upstream Voxtype/Whisper defect, this change ships the missing instrumentation so the next real occurrence is measured instead of guessed, and separately fixes the always-true acceptance criterion: an empty transcript must tell the user something.

## What Changes

- `packages/server/src/voxtype.ts` gains a pure WAV analyzer (sample rate, channel count, bit depth, duration, peak amplitude, RMS) run on every audio buffer handed to Voxtype. The result is logged; when the extracted transcript comes back empty, it is logged at `warn` alongside Voxtype's raw stdout tail, so the next occurrence is measured, not re-guessed.
- The composer's upload-mode (Voxtype) dictation path surfaces a clear message when transcription succeeds (HTTP 200) but returns no words, instead of silently doing nothing — the counterpart to the existing Chrome/Web Speech "heard audio, no words" message.
- No whisper/Voxtype decode parameters are changed, and no capture-side "fix" (such as disabling Chrome's default audio processing) is applied speculatively — see Design for why, and what would justify it once real data exists.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `web-dictation/host-backend`: adds a requirement that an empty Voxtype transcript surfaces a clear message to the operator instead of silently returning to the idle composer.

## Impact

- `packages/server/src/voxtype.ts` — WAV analysis + logging, no behavior change to the returned `{ text }` shape.
- `packages/server/test/voxtype.test.ts` — unit tests for the analyzer against synthetic WAV buffers.
- `packages/ui/src/lib/dictation.ts` — `postWav`'s success handler sets a user-facing error when `text` is empty.
- `packages/ui/src/test/dictation.test.tsx` — covers the empty-transcript-in-upload-mode case.
- `openspec/specs/web-dictation/host-backend/spec.md` — one new scenario.
