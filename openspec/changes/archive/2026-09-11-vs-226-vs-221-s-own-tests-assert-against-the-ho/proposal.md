## Why

`packages/runtime-sdk/src/launch.test.ts` asserts `childEnv` output against the ambient `process.env` (`PATH`, `MISE_DATA_DIR`, `MISE_CONFIG_DIR`, `MISE_CACHE_DIR`). Whether those assertions hold depends on the machine running the suite: green where `MISE_*` is unset, red wherever they are set — as in a worker, whose daemon environment carries them. VS-224's worker reported exactly this (`2183 passed | 2 failed`, reproduced from a `git archive` of `main`) and the mechanism was verified by reading the `??=` chain in `pinHostMiseRoots` (`launch.ts:50-55`). This is the third host-dependent test to bite this week (VS-214's real `current` symlink, VS-218's fixed wait), so the fix must also sweep the suite for the same shape rather than patch one file.

## What Changes

- `launch.test.ts` stops comparing `childEnv` output to `process.env`: every test stubs the daemon environment it assumes (`vi.stubEnv`) and asserts concrete expected values, so it passes both with `MISE_*` set and unset.
- The redirected-HOME tests explicitly unset ambient `MISE_*`, so the derivation from the stubbed HOME/XDG is what is actually asserted, not whatever the host had.
- One new test pins the worker-case precedence the suite previously covered only by accident: when HOME/XDG are redirected and the daemon has its own `MISE_*` roots, the daemon's roots win over the derived ones (VS-221's `??=` chain), while an explicit overlay `MISE_*` still beats the daemon's (existing test keeps that).
- A sweep of the suite for the same shape — assertions against `process.env`, real home-directory paths, installed-tool dependence — naming each hit and fixing or explicitly clearing it with a reason.

No product code changes: `childEnv`/`launchCommand` behaviour is correct and confirmed working by a real worker (VS-224). Tests and test harness only; no global environment scrub in `vitest.setup.ts`.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

(none — test-only change, no spec-level behaviour changes; `skip_specs: true` is set in `.openspec.yaml`)

## Impact

- `packages/runtime-sdk/src/launch.test.ts`, plus whatever the sweep names. No runtime, API, schema or docs changes. Effect: the suite is green and meaningful in worker environments, without weakening any assertion.
