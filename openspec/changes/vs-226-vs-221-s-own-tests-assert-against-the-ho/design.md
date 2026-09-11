## Context

`childEnv(overlay)` (`packages/runtime-sdk/src/launch.ts`) merges the daemon's own `process.env` with an adapter overlay, then `pinHostMiseRoots` fills `MISE_*` via a `??=` chain: an already-present value wins, then the daemon's own `MISE_*`, then a value derived from the daemon's HOME/XDG. `launch.test.ts` asserted the pass-through property by echoing `process.env`, which only holds where the host agrees. The suite runs in at least two shapes of environment: a dev shell (`MISE_*` unset) and a worker (set). See proposal.md for motivation.

## Goals / Non-Goals

- Goals: `launch.test.ts` deterministic in both environment shapes while asserting the same behaviour; an inventory of the same shape elsewhere with each hit fixed or cleared.
- Non-Goals: no change to `childEnv`/`launchCommand` or any runtime behaviour; no global environment scrub in `vitest.setup.ts`; no new shared test utilities unless the sweep demands one.

## Decisions

1. **Per-test `vi.stubEnv` control, not a setup-level scrub.** Scrubbing `MISE_*` in `vitest.setup.ts` would hide the class rather than remove it — the next test to read ambient state would be equally invisible — and would silently change what every existing test sees. Alternative rejected for exactly the reason the ticket states.
2. **Assert concrete values, never echo `process.env`.** The pass-through property is still covered: stub the daemon env to recognizable constants, assert the constants arrive in the child env. Same property, no ambient dependence.
3. **Redirected-HOME tests explicitly unset `MISE_*`.** The `??=` chain keeps any present value, so deriving expectations from stubbed HOME/XDG is only correct when `MISE_*` is absent; making the absence explicit turns "passes when the host agrees" into "passes by construction".
4. **Add the worker-case precedence test** (redirected HOME/XDG + daemon `MISE_*` ⇒ daemon roots win over derived). Real VS-221 behaviour, previously untested — the suite passed in workers by accident. Overlay-explicit `MISE_*` beating the daemon's keeps its existing test.
5. **Sweep method: grep inventory, then per-hit disposition.** Candidates from `process\.env`, `homedir\(` and host-path literals across `*.test.ts(x)`; each hit is fixed in-test (same stub pattern) only where it asserts ambient state, or cleared with a written reason in the PR. A suspected product defect is reported on the ticket, not fixed here.

## Risks / Trade-offs

- [`vi.stubEnv(name, undefined)` must delete, not stringify] → verified empirically: the file is green with garbage `MISE_*` set; the apply-phase re-runs both shapes as the standing check.
- [Sweep creep into unrelated test refactoring] → disposition table bounds the work; fixes limited to ambient-state assertions.
- [Stubbing PATH in more tests could mask resolution regressions] → PATH stubs assert the same pass-through property against constants; `launchCommand` resolution tests already use their own stubbed dirs.

## Migration Plan

None — test-only; lands as a normal PR, no deploy step beyond the usual merge.

## Open Questions

None.
