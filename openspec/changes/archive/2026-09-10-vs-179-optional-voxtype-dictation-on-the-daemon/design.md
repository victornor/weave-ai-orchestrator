## Context

- Web dictation today is Chrome / Web Speech in `packages/ui/src/lib/dictation.ts`, with an upload fallback that posts to `POST /api/transcribe` when `GET /api/health` says `transcription.configured`. `pickMode` **prefers upload** whenever a command provider is set, which is the opposite of "Chrome stays default".
- Daemon config (`DaemonConfigSchema.transcription`) is `{ provider: 'none' | 'command', command? }`. `transcribe()` in `packages/server/src/routes/daemon.ts` pipes raw audio bytes to a shell command's stdin and returns `{ text }`. There is no Voxtype-aware path, no model list, and no Settings writer for `daemon.yaml` (only `writeDaemonConfig` in the loader).
- Host inventory (2026-09-10): `voxtype-bin` 1.0.1, `/usr/bin/voxtype` → `voxtype-vulkan`, user unit `voxtype.service` running `voxtype daemon` (push-to-talk; types into the focused window). `voxtype transcribe <FILE>` transcribes a **WAV, 16 kHz, mono** file; `--engine` is on the subcommand, `--model` is a global flag. `voxtype info models --json` reports `{ engines: { [name]: { default, models: [{ name, installed, downloadable }] } } }`. `--eager-processing` applies to Voxtype's own recorder, not `transcribe`. There is no stdin/streaming transcribe for client audio.
- Settings already has a This-device "Dictation" card for diagnostics capture (VS-121). Backend/model belong on the daemon, not in that card.
- VS-70 / VS-121 landmines stay on the Chrome path: `mergeTranscript`, no second `getUserMedia` in speech mode, diagnostics opt-in. Upload mode already hands the whole transcript once, which matches one-shot Voxtype.

## Goals / Non-Goals

**Goals:**

- Chrome remains default and works without Voxtype.
- Optional Voxtype: client records, host runs `voxtype transcribe`, text in the composer.
- Settings (This daemon) lists backend + installed models; missing Voxtype is explicit, not a crash.
- Take effect without a daemon restart.

**Non-Goals:**

- Live partial words (Voxtype cannot stream client-supplied audio).
- Other ASR vendors; Telegram / TUI.
- Downloading models; talking to `voxtype.service`.
- A per-device backend (captain asked for a daemon setting).
- Changing Chrome merge/diagnostics behavior.

## Decisions

**1. `transcription.backend: chrome | voxtype` (default `chrome`) plus `transcription.model` (optional string) on `daemon.yaml`.** Keep existing `provider` / `command` for yaml-only `POST /transcribe`. Settings never writes `command`. Composer uses Web Speech iff `backend === 'chrome'` (or Voxtype is unusable); upload iff `backend === 'voxtype'` and the probe says installed. This is the BREAKING flip of today's "any configured provider wins."

**2. Dedicated daemon routes, not `PATCH /config`.** Transcription is daemon-wide (`daemon.yaml`), not workspace. New:

- `GET /api/daemon/transcription` → `{ backend, model, voxtype: { installed, models: [{ id, engine, installed }], error? } }`
- `PUT /api/daemon/transcription` `{ backend, model? }` writes `daemon.yaml` via `writeDaemonConfig` and **mutates `deps.daemon.transcription` in place** so the next `POST /transcribe` / health read sees it without restart.

`GET /api/health` `transcription` grows to `{ configured, backend }` so the composer can pick a mode without a second round-trip; `configured` means "Voxtype selected and installed" (or legacy command still set). Document in `docs/API.md`.

**3. Probe and transcribe through a fakeable `VoxtypeProbe`, never the live PTT daemon.** Resolve `voxtype` on `PATH`. `info models --json` for the picker (selectable = `installed: true` only). Transcribe: write the upload to a temp `.wav`, spawn `voxtype --model <id> transcribe <path>` (global `--model`; subcommand has none), read stdout, unlink in `finally`. Inherit the daemon process env (operator `HOME` / XDG — systemd user unit). Tests inject a fake binary + scratch config dir; they never call `/usr/bin/voxtype`. Do not `voxtype record` / `voxtype daemon`.

**4. Client encodes 16 kHz mono WAV; one-shot on stop.** Voxtype rejects typical MediaRecorder webm. Upload mode records via `AudioContext` capture, downsamples to 16 kHz mono PCM, encodes WAV, POSTs `audio/wav`. No ffmpeg on the host. Composer already treats upload as one transcript on stop; keep the meter and timer. No chunked re-transcribe.

**5. New daemon Settings section `dictation`, not the This-device card.** `SETTINGS_SECTIONS` gains `{ key: 'dictation', label: 'Dictation', area: 'daemon' }`. Backend as segmented Chrome | Voxtype (Voxtype disabled + hint when `installed: false`). Model `<select>` of installed models, shown when Voxtype is selected. Diagnostics stay under This device. Deep link `?section=dictation`.

**6. Default model.** If `transcription.model` is empty or not installed, use Voxtype's engine default when that model is installed, else the first installed model. Persist the resolved id on first successful Voxtype save so the picker is not blank next time. Selecting an uninstalled id is `validation` 400.

## Risks / Trade-offs

- **[Risk] `voxtype info models --json` follows XDG/HOME.** A worker or isolated daemon with a different home sees no models. → Mitigation: the real daemon inherits the operator environment; tests stub JSON; Settings treats an empty installed list as "no model ready", not as Chrome broken.
- **[Risk] Vulkan/GPU transcribe can be slow or fail if GPU is busy.** → Mitigation: bounded spawn timeout, stderr truncated into the 500 the composer already shows as "Transcription failed on the daemon"; operator can switch back to Chrome.
- **[Trade-off] Daemon-wide backend.** A phone that only has Web Speech still follows Voxtype once selected; upload mode needs `getUserMedia` + WAV encode, which phones have. If Voxtype is selected and the browser cannot record, the mic explains itself the way unavailable already does.
- **[Trade-off] One-shot vs Claude-like live words.** Honest: `transcribe` is a file. Shipping fake partials would guess. Meter + timer is the live feedback this change keeps.
- **[Risk] In-place mutation of `deps.daemon.transcription` vs a copied object.** Schema parse returns a new object; PUT must assign onto `deps.daemon` (the same object `transcribe()` closes over), not replace a frozen snapshot. Tests assert a transcribe after PUT uses the new backend without rebuilding `AppDeps`.

## Migration Plan

Existing daemons have `transcription.provider: none` and no `backend`. Zod default `chrome` matches today's Chrome-first composer for those hosts. A host that already set `provider: command` keeps a working `POST /transcribe` for non-UI callers; the web composer stops auto-switching to it until Voxtype is selected (the BREAKING note). Rollback: revert the code; leftover `backend` / `model` keys are unknown to the old schema and would fail `DaemonConfigSchema` — **strip unknown keys is not current behavior**, so PUT must write only known keys, and we add `backend`/`model` as optional-with-default so an old binary that somehow saw them is not the rollback path; rolling back the release before the schema change requires those keys absent. PUT of `backend: chrome` (the default) can omit writing them if still default, but once written, rollback of the *binary* without the yaml would fail to parse. Mitigation: the new fields are inside the existing `transcription` object with defaults, and `DaemonConfigSchema` already `.default({})`s that object — **an old binary without `backend` in the enum will reject yaml that contains `backend: voxtype`.** Rollback procedure: set backend to Chrome in Settings (or delete the two keys from `daemon.yaml`) before running an older release, or this change's schema must use `.passthrough()` — we will not; document "set Chrome before rollback" in the PR.

## Open questions

None. Live streaming is infeasible with `voxtype transcribe`; one-shot is the accepted path per the ticket.
