## 1. The singleflight freshness check

- [x] 1.1 Add `packages/core/src/runs/credentialFreshness.ts` exporting `ensureFreshCredential(input)`
  where `input` carries `runtimeId`, `configHome`, the resolved `RuntimeAdapter`, `minValidMs` (the
  turn's own timeout) and a `reconcile: () => void` callback; it returns
  `Promise<{ ok: true } | { ok: false; message: string }>`. When the adapter has no `readCredential`
  or no `describeAccount`, resolve `{ ok: true }` immediately with no reconcile, no probe, no lock.
  Verify with a unit test that an adapter missing either method causes zero calls to anything.
- [x] 1.2 Implement the fast path: call `reconcile()` then `adapter.readCredential({ configHome })`;
  if `present` is true and `expiresAt` is readable and at least `minValidMs` away, resolve
  `{ ok: true }` with no lock taken and no probe run. Verify with a unit test that a fresh credential
  never triggers `describeAccount`.
- [x] 1.3 Implement the singleflight: a module-level `Map<string, Promise<{ ok: boolean; message?:
  string }>>` keyed by `runtimeId` only (not by workspace — the credential this protects is shared
  per host, not per workspace, per VS-75). The first caller for a `runtimeId` with no entry becomes
  the leader: it calls `reconcile()`, then `adapter.describeAccount({ configHome, env: {}, timeoutMs
  })`, then re-reads `readCredential` to decide the outcome, then calls `reconcile()` again, deletes
  the map entry, and resolves the shared promise for every caller including itself. A caller that
  finds an entry already present awaits it and performs no probe of its own. Verify with the test in
  2.1 below.
- [x] 1.4 Decide the outcome from the **re-read** credential facts after the probe, not from the
  probe's own return value or note text: `{ ok: true }` when `present && expiresAt` is now readable
  and in the future (do not re-require the full `minValidMs` here — a probe that leaves a short-lived
  but valid token is still progress, and re-checking against the buffer belongs to the next turn's
  own fast-path call, not to this function); `{ ok: false, message }` otherwise, with `message` built
  from the probe's own `note` when present. Verify with a unit test covering both outcomes from a
  scripted fake adapter.

## 2. Proving the concurrency property (acceptance criterion 3)

- [x] 2.1 Add a test in `packages/core/src/runs/credentialFreshness.test.ts` using a fake adapter
  whose `describeAccount` simulates a rotating credential endpoint: each call increments a shared
  counter, writes a fresh `expiresAt` to a scratch file, and `readCredential` reads that file. Start
  N (at least 8) concurrent `ensureFreshCredential` calls against a credential that starts expired;
  assert the counter is exactly 1 regardless of N, and every one of the N calls resolves `{ ok: true
  }`. This is acceptance criterion 3's own test — confirm it fails against the pre-change code path
  (i.e. write it first against a version that calls `describeAccount` per caller, see it call N
  times, then implement 1.1–1.4 and see it drop to 1).
- [x] 2.2 Add a test that a failing probe (the fake adapter's `describeAccount` reports `unknown` and
  `readCredential` still reports the stale/absent state afterwards) resolves `{ ok: false }` for every
  one of N concurrent callers, and that `describeAccount` was still called exactly once.
- [x] 2.3 Add a test that two back-to-back bursts (not concurrent) each trigger their own probe: the
  map entry must not persist after resolution, or a runtime would be permanently gated by one stale
  cached outcome.

## 3. Wiring into the run engine

- [x] 3.1 In `packages/core/src/runs/engine.ts`, inside the existing `phase('turn', ...)` block and
  before `runtime.runTurn(...)` is called, call `ensureFreshCredential` with `minValidMs` derived from
  `ctx.config.defaults.turnTimeoutSec` (the same value already used at the `limits.timeoutMs` line),
  the already-resolved `runtime` adapter, `setting.runtime`, the reconciled `configHome` already
  computed for `TurnInput`, and a `reconcile` callback that calls `reconcileRuntimeCredential` the
  same way the existing line above it does. On `{ ok: false, message }`, throw
  `Object.assign(new Error(message), { ocFamily: 'auth', ocCode: 'credential_refresh_failed' })` —
  the same pattern already used a few lines above for an unregistered runtime — so it is caught by
  the function's existing `catch` and reaches the existing `errorFamily === 'auth'` handling
  (`gateRuntimeForLogin`) unchanged. Verify `pnpm vitest run packages/core/src/runs/engine.test.ts`
  stays green with no changes to existing cases (they use `FakeRuntime`, which has neither
  `readCredential` nor `describeAccount`, so this is a no-op for every one of them).
- [x] 3.2 Add an engine-level integration test with a `LeakyRuntime`-style subclass of `FakeRuntime`
  (matching the pattern already in `engine.test.ts`) that implements `readCredential` (reporting an
  expired credential) and `describeAccount` (reporting a fresh one, incrementing a call counter).
  Dispatch two runs on the same runtime whose executions overlap (use the existing
  `runtime.delayMs`/queued-result pattern to hold the first run's `runTurn` open) and assert
  `describeAccount` was called exactly once across both, and that both runs' `TurnInput`s were built
  (i.e. both actually spawned) rather than one blocking the other's turn itself.
- [x] 3.3 Add an engine-level test that a `LeakyRuntime` whose `describeAccount` never restores a
  valid credential produces exactly the same outcome as today's turn-level `auth` failure: the run
  finalizes with `errorFamily: 'auth'`, `gateRuntimeForLogin` fires (reuse whatever assertion the
  existing turn-level auth-failure test in `engine.test.ts` around line 557 already uses), the
  runtime's other agents are still gated by the dispatcher's existing `needs_login` filter, and no
  retry wake is scheduled. Verify this needs no change to `dispatcher.ts`, `authgate.ts` or the
  `login-outage` behavior — only the trigger is new.

## 4. Reconciliation still holds under the new path (acceptance criterion 4)

- [x] 4.1 Add a test that while the singleflight probe is in flight, a fake concurrent write to the
  credential path with a *later* expiry (simulating the owner's own CLI or another process refreshing
  independently) is not clobbered by the probe's own `reconcile()` call afterwards — the later-expiry
  credential survives, per the existing `single-credential` monotonic-reconcile requirement. This
  reuses `reconcileRuntimeCredential`/`credentials.test.ts`'s existing fixtures rather than
  reimplementing reconcile logic.

## 5. Documentation

- [x] 5.1 Add a paragraph to `docs/OPERATIONS.md` §7 (after "Repair", before "Upgrading") describing
  the pre-spawn freshness check and the singleflight: that a turn will not spawn until its runtime's
  credential is confirmed valid for the turn's own timeout, that at most one refreshing probe runs
  per runtime at a time host-wide, and that a probe that cannot restore a working credential is
  handled by the same gate described in "When a login expires" immediately below it. Verify the
  section still reads in order and does not duplicate "When a login expires".

## 6. Verification

- [x] 6.1 Run `pnpm typecheck` (chains `tsc -b` then the ui filter) and `pnpm lint`; verify both are
  clean.
- [x] 6.2 Run `pnpm vitest run` and `pnpm --filter @agent-conductor/ui exec vitest run` separately;
  verify both suites pass. No test in this change uses a real credential file with a real token or
  contacts Anthropic; every probe is a fake adapter or a fake CLI binary.
- [x] 6.3 Confirm the test from task 2.1 fails on the pre-change code (call count > 1 for N > 1) before
  task 1's implementation lands, and passes after — this is the test the ticket calls "the one that
  matters."
