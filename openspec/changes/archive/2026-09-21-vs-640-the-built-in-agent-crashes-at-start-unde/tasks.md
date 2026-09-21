## 1. A wrapper environment separate from the command environment (runtime-sdk)

- [x] 1.1 Add `containmentWrapperEnv(source)` to `packages/runtime-sdk/src/containment.ts`: return only the keys a `systemd-run` wrapper needs to reach the user manager — `XDG_RUNTIME_DIR` and `DBUS_SESSION_BUS_ADDRESS` — when they are present in `source`, and an empty object otherwise. Verify in `packages/runtime-sdk/src/containment.test.ts` that it picks both keys when set, omits one that is absent, and returns `{}` when neither is set.
- [x] 1.2 In `packages/runtime-sdk/src/process.ts`, add `containmentEnv?: Record<string, string>` to `SpawnOpts` and factor the spawn into a pure `planSpawn` builder (the single source of truth `spawnLines` uses) that, when wrapping: spawns `systemd-run` with `{...env, ...containmentEnv}` and prefixes the contained command with `env -u <key>` for each `containmentEnv` key; when not wrapping, returns `cmd`/`args`/`env` unchanged and adds no `env -u`. Verify in `process.test.ts` with containment on and `containmentEnv: { XDG_RUNTIME_DIR: '/run/user/1000' }` that the wrapper command is `systemd-run`, the wrapper env contains `XDG_RUNTIME_DIR`, and the contained argv is prefixed `env -u XDG_RUNTIME_DIR`, while the command's own env and argv gain nothing when containment is off or unavailable.
- [x] 1.3 Make the availability decision and the spawn function injectable on `spawnLines` (defaulting to `systemdScopeAvailable()` and `node:child_process`'s `spawn`) so a test can drive the contained path without a live manager. Verify in `process.test.ts` with a fake spawn and `available: true` that the fake is invoked with the wrapper env and the `env -u` argv.

## 2. A wrapper that cannot start fails in plain words (runtime-sdk)

- [x] 2.1 Add `containmentStartFailure(stderr)` to `packages/runtime-sdk/src/containment.ts`, matching the systemd-run user-bus failure text captured from the VS-639 run (`Failed to connect to user scope bus via local transport: $DBUS_SESSION_BUS_ADDRESS and $XDG_RUNTIME_DIR not defined`, stored as a fixture, not retyped). Verify in `containment.test.ts` that the captured bytes match and an ordinary crash line does not.
- [x] 2.2 Set a `containmentFailed` flag on the spawn outcome in `process.ts` only when the process was wrapped (`scopeUnit !== null`), it produced no `result`, and `containmentStartFailure` matches its stderr. Verify in `process.test.ts` with the fake spawn emitting the captured bus text and exiting non-zero that `containmentFailed` is true, and that an unwrapped run of the same text is false.

## 3. The weave adapter opts in and reports containment-unavailable

- [x] 3.1 In `packages/runtimes/weave/src/adapter.ts`, build the turn spawn with `containmentEnv: containmentWrapperEnv(base)` while keeping `env: childBaseEnv(base)` unchanged (the allowlist). Verify in `packages/runtimes/weave/test/adapter.test.ts` (via the injected fake spawn with containment on and `XDG_RUNTIME_DIR` set) that the wrapper environment contains `XDG_RUNTIME_DIR` and that the environment recorded by the fake agent contains nothing beyond `PATH`, `HOME`, `LANG`, `TMPDIR`.
- [x] 3.2 In the adapter's `finish()` path, when the spawn was wrapped and `containmentFailed` is set, return `{ code: 'containment_unavailable', family: 'tooling', message: 'Containment is unavailable: the systemd user manager could not be reached, so the agent was not started.' }` instead of `agent_crashed` with the bus text. Verify in `adapter.test.ts` with the injected fake spawn emitting the captured bus text that the turn result carries that code and message, and that a genuine contained crash still reports `agent_crashed` (and SIGKILL/137 still `killed`).
- [x] 3.3 Confirm the key never reaches argv or any environment still holds: re-run the existing "puts the key only on stdin" and workspace-store-key tests in `adapter.test.ts`.

## 4. Check the other scrub paths

- [x] 4.1 Confirm by reading the code and, where already covered, by test, that `compactSession` (`adapter.ts`, spawns with `childBaseEnv(childEnv())` but no `containment`) runs no wrapper and so gains no bus variables, and that `toolEnvFor` (the bash tool env) runs inside the started agent, not under a wrapper, and stays unchanged.

## 5. Verification and hand-off

- [x] 5.1 Iterate on the changed test files until green, then run `pnpm lint` and `pnpm typecheck`.
- [x] 5.2 Run one full `pnpm test` with `VITEST_MAX_WORKERS=4` and paste both suite blocks verbatim in the ticket report.
- [ ] 5.3 Comment on VS-639 that the weave-runtime containment fix has landed and its worker can be relaunched.
