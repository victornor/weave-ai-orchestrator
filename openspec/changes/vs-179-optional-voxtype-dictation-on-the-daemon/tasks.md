## 1. Schema and health

- [x] 1.1 Extend `DaemonConfigSchema.transcription` (`packages/shared/src/config.ts`) with `backend: z.enum(['chrome', 'voxtype']).default('chrome')` and `model: z.string().optional()`. Keep `provider: none | command` and `command`. Verify `DaemonConfigSchema.parse({})` yields `backend: 'chrome'` and no model; `provider: 'command'` still parses.
- [x] 1.2 Expand `GET /api/health` `transcription` to `{ configured, backend }` where `configured` is true only when host transcription will actually run (Voxtype selected and installed, or legacy `provider === 'command'` with a command). Document in `docs/API.md`. Verify a default daemon reports `backend: 'chrome'` and `configured: false`.

## 2. Voxtype probe and transcribe

- [x] 2.1 Add a `VoxtypeProbe` (new module under `packages/server` or `packages/core`) with `status(): { installed: boolean, models: { id, engine, installed }[], error?: string }` implemented by spawning `voxtype info models --json` (PATH lookup; injectable binary path for tests). Parse `engines.*.models`; never call the host `/usr/bin/voxtype` from a test — use a fake binary that prints fixture JSON. Verify: missing binary → `installed: false`; fixture with two installed whisper models → those ids; a failing spawn → `installed: false` plus error, not a throw.
- [x] 2.2 Change `transcribe()` so `backend === 'voxtype'` writes the upload to a temp `.wav`, runs `voxtype --model <id> transcribe <path>` (model from config, else probe default/first installed), returns `{ text: stdout.trim() }`, and unlinks the file in `finally`. `provider === 'command'` stays the stdin path. Else 501. Verify with a fake binary: WAV bytes in, expected stdout out, temp file gone; missing binary → error not 501-as-success; command provider still 200 when configured.
- [x] 2.3 Bound the spawn (timeout + truncated stderr in the OcError). Verify an infinite fake binary is killed and the route errors.

## 3. Daemon transcription routes

- [x] 3.1 `GET /api/daemon/transcription` returns `{ backend, model, voxtype: { installed, models } }` from `deps.daemon.transcription` plus the probe. `PUT /api/daemon/transcription` `{ backend, model? }` validates (Voxtype backend requires installed binary; model if set must be an installed id), writes `daemon.yaml` via `writeDaemonConfig`, and assigns onto `deps.daemon.transcription` so a subsequent `POST /transcribe` uses it without rebuilding AppDeps. 400 `validation` on a bad model. Document both in `docs/API.md`. Verify GET default chrome; PUT voxtype+model persists and is visible on GET; PUT voxtype when probe says missing is 400; chrome PUT succeeds when Voxtype is missing.
- [x] 3.2 Add the routes to `packages/server/src/routetable.ts`. Operator session auth, not run tokens.

## 4. Composer follows the daemon backend

- [x] 4.1 `pickMode` / `useDictation`: upload only when health (or an explicit opt) says `backend === 'voxtype'` and recording is possible; otherwise speech if `speechCtor()`, else unavailable. A configured `command` provider MUST NOT force upload while backend is chrome. Verify existing Chrome dictation tests still pass unchanged in speech mode; a new test with `serverConfigured`/health `{ backend: 'voxtype', configured: true }` takes upload and POSTs WAV on stop; health `{ backend: 'chrome', configured: false }` stays speech even if a leftover `configured: true` from command would previously have won — encode the new rule, not the old.
- [x] 4.2 Upload mode encodes 16 kHz mono WAV (AudioContext capture + PCM encode) and POSTs `audio/wav` to `/api/transcribe`. Verify the posted blob type/name in a jsdom test with a stubbed MediaRecorder/AudioContext as far as jsdom allows; if encoding needs a small pure helper, unit-test that helper with a known PCM fixture.
- [x] 4.3 Failed host transcribe still surfaces the existing "Transcription failed on the daemon" (or the server message). Chrome path, diagnostics, `mergeTranscript`, and "no second getUserMedia in speech mode" stay untouched.

## 5. Settings: daemon Dictation section

- [x] 5.1 Add `{ key: 'dictation', label: 'Dictation', area: 'daemon' }` to `SETTINGS_SECTIONS`. New `DictationSection`: segmented Chrome | Voxtype (Voxtype disabled + "not installed" hint when `voxtype.installed` is false), model `<select>` of `installed: true` models when Voxtype is selected. Hooks against `GET/PUT /api/daemon/transcription`. Diagnostics remain in This device. Verify `?section=dictation` opens the daemon area; Chrome is selected by default; Voxtype is not activatable when not installed; choosing Voxtype + a model PUTs and the next GET shows them; This-device diagnostics toggle still exists.
- [x] 5.2 Update `web-settings/settings-scopes` tests / any Settings route mocks that enumerate sections (`settingsScopes.test.tsx` and every file that mocks `../api/hooks` and renders Settings) so the new section and hooks do not break them.

## 6. Docs and verification

- [x] 6.1 Update `docs/PLAN.md` remote-dictation line: Chrome / Web Speech is default; optional Voxtype on the daemon; one-shot host transcribe, not live partials. Mention `transcription.backend` in the daemon.yaml notes in README if that table lists transcription keys.
- [x] 6.2 `pnpm typecheck && pnpm lint && pnpm test` green. No test spawns the real `voxtype` binary or talks to `voxtype.service`.
