## 1. Remove the forced pre-spawn refresh

- [x] 1.1 Remove the `ensureFreshCredential` call from `packages/core/src/runs/engine.ts`'s turn-spawn
      path, and everything that belonged only to it (the pre/post-probe `reconcile()` calls inside
      `ensureFreshCredential`/`refresh()`). Keep the existing, independent `reconcileCredential()` call
      that already runs once per spawn today exactly where it is — it stays (see design.md Decision
      2: it only writes when it finds a real fork, and that write is what heals captain's own session
      within one turn instead of leaving it broken until a restart). Verify a turn's `TurnInput` is
      built and `runtime.runTurn` is invoked with the one existing reconcile call still in place and
      no describeAccount-based freshness check, by reading the updated spawn path.
- [x] 1.2 Delete `packages/core/src/runs/credentialFreshness.ts` and
      `packages/core/src/runs/credentialFreshness.test.ts`. Verify `pnpm typecheck` reports no
      dangling import of `ensureFreshCredential`, `minValidMs`, or the module itself anywhere in
      `packages/core`.
- [x] 1.3 Update `packages/core/src/runs/engine.test.ts`: remove tests asserting the freshness gate
      blocks or delays a spawn, remove tests asserting a shared-probe failure routes through
      `login-outage` (that path no longer exists as such), and keep/adjust the tests asserting a
      turn's own reported authentication failure still gates the runtime (`family: 'auth'` from the
      runtime's own output, per `packages/runtime-sdk/src/process.ts`). Verify
      `engine.test.ts` passes.

## 2. Stop reconciling during the account/usage probe

- [x] 2.1 Remove the `reconcileRuntimeCredential(...)` call inside `probe()` in
      `packages/core/src/usage/accounts.ts`, keeping the `describeAccount` call for billing/plan
      reporting unchanged. Verify the existing usage-probe tests still pass with the reconcile call
      gone.

## 3. Prove the write behavior is exactly the repair, nothing more

- [x] 3.1 Add a test to `packages/core/src/workspace/credentials.test.ts` proving that reconciling an
      already-intact symlink touches neither the host nor the workspace path — asserted by inode
      identity before/after (`'touches neither path when the link is already intact'`), which is a
      stronger and more precise proof than instrumenting the engine's fake runtime: the fake runtime
      has no entry in `credentialPaths`' candidate map, so it never exercises real credential-path
      filesystem behavior at all. This is the correct home for this proof, not `engine.test.ts`.
- [x] 3.2 No new test needed: `credentials.test.ts`'s pre-existing `'adopts the newer credential when
      the CLI replaced the link with its own file'` (and its neighbors in the `'reconciling a forked
      credential'` describe block) already prove `reconcileRuntimeCredential` repairs a genuine fork —
      this behavior is unchanged by this ticket, so the existing coverage is the proof.
- [x] 3.3 Added `'spawns a turn without probing for a refresh, even when the credential looks near
      expiry'` to `packages/core/src/runs/engine.test.ts`: a fake runtime whose `describeAccount`
      throws if ever called, with a credential already expired — the turn still succeeds and
      `describeCalls` stays 0. This is the acceptance-criterion-1 proof; it fails on the pre-change
      code (the old `ensureFreshCredential` would have called `describeAccount` and hit the throw).
- [x] 3.4 Added `'does not reconcile a forked credential as a side effect of a probe'` to
      `packages/core/src/usage/accounts.test.ts`: seeds a genuine fork under a scratch `HOME`, calls
      `accounts.refresh(['claude'])`, and asserts the host file's bytes are unchanged afterward. Fails
      on the pre-change code (the old `probe()` would have repaired the fork).
- [x] 3.5 No new test needed: `credentials.test.ts`'s `'adopting an existing workspace credential
      once'` describe block already covers `linkRuntimeCredentials` at the bootstrap call site, which
      this ticket does not touch.

## 4. Documentation

- [x] 4.1 Update `docs/OPERATIONS.md` §7 to remove the description of the pre-spawn freshness gate
      and singleflight (VS-105), and state the current posture: a turn spawns unconditionally, the CLI
      refreshes on its own terms, and only the runtime's own reported authentication failure gates it.
      Verify by re-reading §7 against the merged code.

## 5. Full verification

- [x] 5.1 Run `pnpm lint`, `pnpm typecheck`, and both test suites (`vitest run` and
      `pnpm --filter @agent-conductor/ui exec vitest run` if UI is touched — this change does not
      touch `packages/ui`, so confirm that filter is unnecessary before skipping it) and record all
      totals verbatim in the ticket's delivery comment, per acceptance criterion 7.
