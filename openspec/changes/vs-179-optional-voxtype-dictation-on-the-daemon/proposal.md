## Why

Chrome's Web Speech API is an okay default, but dictation currently has no first-class way to use Voxtype on the daemon host — audio never leaves the browser vendor's speech service, and the existing `transcription.provider: command` yaml escape hatch auto-steals the mic from Chrome the moment it is set. Captain asked for an optional Voxtype backend: the client records, the host transcribes, Chrome stays default.

## What Changes

- Daemon setting `transcription.backend`: `chrome` (default) | `voxtype`. Settings (This daemon) offers that choice and, when Voxtype is selected, a model picker of **installed** Voxtype models on the host.
- When Voxtype is selected and installed, the composer captures audio and `POST /api/transcribe` runs `voxtype transcribe` on the daemon host; the returned text lands in the composer. **One-shot, not live:** Voxtype's file transcribe has no streaming API for client-supplied audio (`--eager-processing` is for Voxtype's own recorder). Partial word-by-word animation is out of this change; the meter and timer already shown in upload mode stay.
- Chrome / Web Speech path is unchanged when Chrome is selected — including when Voxtype is installed but not selected, and when Voxtype is missing.
- Voxtype is never required. If the binary is absent, Settings disables the Voxtype option and explains it is not installed. Chrome dictation still works.
- **BREAKING** for anyone who already set `transcription.provider: command` expecting the composer to auto-switch to daemon upload: Chrome stays until Voxtype is chosen. The yaml `command` provider remains on `POST /transcribe` as a power-user path; Settings does not offer it.

## Capabilities

### New Capabilities

- `web-dictation/host-backend`: daemon chrome|voxtype choice, installed-model listing, host-side Voxtype transcribe, composer routing, and the missing-Voxtype / Chrome-default guarantees.

### Modified Capabilities

- `web-settings/settings-scopes`: the daemon area also holds the dictation backend and model. Existing scenario names are kept. Diagnostics capture stays a This-device setting.

## Impact

- `packages/shared` — `DaemonConfigSchema.transcription` gains `backend` and `model`.
- `packages/server` — probe Voxtype (`info models --json`), persist backend/model to `daemon.yaml`, take effect without restart, `POST /transcribe` runs `voxtype transcribe` on a 16 kHz mono WAV. Tests use a fake `voxtype` binary, never the host one.
- `packages/ui` — daemon Dictation section; `useDictation` follows the daemon backend instead of "any provider configured". Chrome speech mode and diagnostics are untouched.
- `docs/API.md`, `docs/PLAN.md` (remote dictation line).

## Out of scope

- Other ASR vendors; Telegram / TUI.
- Bundled model download; talking to the running `voxtype.service` PTT daemon (it types into the focused host window).
- Live partial transcripts.
