## 1. Track the resolved runtime on the render marker

- [x] 1.1 Add `runtimeId: string` to the `Marker` interface (`packages/core/src/workers/home.ts`) and
      include `runtimeId: agent.runtimeId` in `currentRevisions()`'s returned object. Verify
      `pnpm typecheck` passes with the widened shape.
- [x] 1.2 In `ensureHomeCurrent()`, compute `runtimeChanged = !!marker && marker.runtimeId !==
      cur.runtimeId` and fold it into the existing re-render condition (alongside `missing`,
      `briefUpdated`, `charterChanged`) so any one of them triggers `renderHome()`. Verify with a unit
      test: an agent whose marker's `runtimeId` differs from its current `runtimeId` gets `renderHome`
      called even when brief/spec revisions are unchanged, and one whose marker matches does not.
      Covered by `packages/core/src/workers/home.test.ts`.
- [x] 1.3 Verify a marker written by the pre-fix code (no `runtimeId` key at all) is treated as a
      mismatch and triggers exactly one re-render — the self-healing path for currently-live workers.
      Cover with a unit test that seeds a marker file missing the field. Covered by
      `packages/core/src/workers/home.test.ts`.

## 2. Regression test against `skills/manifest.json`

- [x] 2.1 Add a test (colocated per project convention, e.g. `packages/core/src/workers/home.test.ts`)
      that loads `skills/manifest.json` and asserts `skillsFor(ctx, 'worker')` returns exactly the
      skills whose manifest `audience` is `worker` or `all`, and none whose audience is `conductor`.
      Verify it fails if a skill's audience in the fixture manifest is changed.
- [x] 2.2 Extend that test (or add a sibling one) to render a worker home for at least the `claude` and
      `opencode` runtimes and assert each returned skill's directory exists under the path
      `skills/manifest.json`'s `runtimes[<id>].path` resolves to for that skill name. Verify the test
      fails if an adapter's hardcoded `skillsDir` (e.g. `packages/runtimes/claude/src/adapter.ts`) is
      changed to not match the manifest. Implemented as new tests in
      `packages/runtimes/claude/test/adapter.test.ts` and
      `packages/runtimes/opencode/test/adapter.test.ts` (each package owns its own adapter, so the
      manifest-path assertion lives with the adapter rather than in `packages/core`, which the
      dependency-boundary guard forbids from importing a runtime package even in a test), plus
      `packages/core/src/workers/home.test.ts`'s `renderHome` test confirming both runtimes resolve
      through `skillsFor`.
- [x] 2.3 Add a test that renders a worker home under one runtime, then changes the agent's `runtimeId`
      and calls `ensureHomeCurrent()` again, asserting the new runtime's skill directory is now
      populated (per task 1.2). Verify it fails without the task 1 fix (i.e. run it against the
      pre-fix code once to confirm red, per the project's usual practice — do not leave that
      confirmation step in the final diff). Confirmed red against the pre-fix logic (temporarily
      reverted locally, not committed) before restoring the fix; both new `ensureHomeCurrent` tests
      failed as expected.

## 3. Verification

- [x] 3.1 `pnpm lint && pnpm typecheck && pnpm test` all pass. `pnpm lint` and `pnpm typecheck` are
      clean. `pnpm test` is clean except a pre-existing, unrelated flake in
      `packages/core/src/usage/usage.test.ts` ("groups by model and ticket .../ "aggregates per model
      with provider") that reproduces on repeated runs of that file alone, touches no file this change
      modifies, and was not introduced here.
- [x] 3.2 `openspec validate vs-189-worker-skills-install-under-the-wrong-ru --strict` passes.
- [x] 3.3 State in the PR description that this was verified without invoking a real coding CLI against
      live credentials — assertions are against the provisioned directory tree and the manifest, never
      by launching a runtime (charter rule of 2026-09-07).
