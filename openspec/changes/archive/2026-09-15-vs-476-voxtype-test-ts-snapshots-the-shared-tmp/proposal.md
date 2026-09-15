# Isolate `voxtype.test.ts` from the shared tmpdir

Tracker change for [VS-476](weave://tickets/VS-476). A `task` ticket, so this change carries tasks
only — `skip_specs: true`.

## Why

VS-475, while proving the `auth.test.ts` flake fix under a 3 × 3 concurrent-suite stress, saw 8/9
green with a shared `TMPDIR`; the one failure was `packages/server/test/voxtype.test.ts`. Re-running
that stress here failed **7/9** runs, every one of them on the same test:

```
× VoxtypeProbe > transcribes a wav via the fake binary and deletes the temp file
  → expected false to be true // Object.is equality
  packages/server/test/voxtype.test.ts:256:67
```

The test snapshots `readdirSync(tmpdir())` for `ac-voxtype-*` entries, calls the code under test, then
asserts that every entry it did not see before is gone. That scan is the whole system temp directory:
another process's in-flight `ac-voxtype-*` directory — created by the same `transcribe()` in a
concurrent suite run, or by any other process doing the same — lands in the window between the two
snapshots and the "no leftovers" assertion fails, although this test cleaned up everything it made.

A single serial landing run never hits it; local parallel runs and any future concurrent CI do.

## What changes

Test-only. The code under test is untouched — no leak was found: `transcribe()` removes its temp
directory in a `finally`.

- **Point the code under test at a per-test temp directory.** `os.tmpdir()` already honours
  `TMPDIR`, so the test `vi.stubEnv('TMPDIR', <fresh mkdtemp>)` for the duration of the call and
  asserts that directory is empty afterwards. The scan can then only ever see directories this test's
  own `transcribe()` created, which is the cleanup the assertion is actually about.
- **Restore the environment.** `afterEach` gains `vi.unstubAllEnvs()`, so a throwing call still
  restores `TMPDIR` for the rest of the file.
- **Sweep.** `packages/server/test/voxtype.test.ts` is the only server or core test that asserts on
  a whole `tmpdir()` listing; the other `readdirSync` calls in those packages read their own
  temp/config directories, and the remaining `tmpdir()` uses are `mkdtemp` bases or a clone
  destination. Nothing else needs converting.

## Out of scope

- Product code, and the other flake hardening (VS-475's `auth.test.ts` fix, VS-453's lazy-chunk
  waits) — referenced only.