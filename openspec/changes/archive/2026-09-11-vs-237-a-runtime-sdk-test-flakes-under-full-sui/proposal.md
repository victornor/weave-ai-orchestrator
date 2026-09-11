## Why

`packages/runtime-sdk/src/process.test.ts` `"open mode keeps stdin writable"` failed once
during VS-234's first full `pnpm test` and passed in isolation and on re-run. A test that
is red only under suite load trains every worker to re-run until green.

The cause is the test, not `spawnLines`. It writes `'first\n'`, sleeps 50ms, writes
`'second\n'`, sleeps 50ms, then asserts both echo lines are already in `onLine`. That is
an assertion on a wall-clock guess, not on the condition the test cares about (stdin
stayed open and both writes were echoed).

Reproduction (same 50ms waits as the test, against real `spawnLines`):

- Idle, sequential: first-echo 10–17ms; 0/40 failures.
- Full-suite-like load (32 CPU busy-loops + 48 workers looping `node -e 'process.exit(0)'`
  + 32 concurrent trials, with a `vitest run` of the core suite overlapping): **21/128
  failures**. Every failure had `write()` return `true`, the child eventually printed
  `echo:first\necho:second\n` and exited 0. The assertion ran at t≈100ms; echoes arrived
  at 115–249ms. Two shapes: child start late (both stamps equal, `after100` empty or
  first-only) and first echo on time but second echo >50ms after the second write.

Product behaviour is not racy. No retry plugin.

## What Changes

- Replace both `setTimeout(..., 50)` sleeps with `vi.waitFor` on the echo lines, so the
  test waits for the round-trip it actually cares about. Assert `write()` returns `true`.
  Wait for `echo:first` before the second write so the two writes are separate, not one
  coalesced stdin chunk.
- Leave the two sibling tests in this file alone: they already wait on `run.done`.
- Tests only. No `spawnLines` behaviour change, no retry / skip / widened sleep.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

(none — test-only change; `skip_specs: true`)

## Impact

- `packages/runtime-sdk/src/process.test.ts` only.
