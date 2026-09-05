# A detached project add that fails is contained instead of escaping the process

For [VS-53](conductor://tickets/VS-53).

## Why

`startAdd` and `retryAdd` answer before the add pipeline has run and drop the promise on the floor
(`packages/core/src/projects/index.ts:247,258`):

```ts
void runAdd(project.id, cfg, jobId, actor);
```

`runAdd`'s own `catch` records the failure on the job and on the project row, logs it, and then
re-throws — which is right for `add`, the one caller that awaits it, and wrong for these two, which
do not. Nothing handles the rejection, so a failed add surfaces as an **unhandled rejection**: in the
daemon it is an unhandled rejection in the process rather than a failed job, and in the test suite it
holds the exit code at 1 on every single run. `pnpm exec vitest run` on `main` today reports
959 passed / 0 failed and exits 1, from `projects.test.ts`'s deliberate clone of
`/definitely/not/a/repo`. That non-zero exit is the delivery gate of every worker on this repository.

VS-44 fixed the same class of bug for the ticket service's detached timers; this is the one call site
it ruled out of its own scope (decision `vs-44-projects-unhandled-rejection`, answered `split_out`).

## What Changes

- The projects service gets a small internal `detach(slug, promise)` helper that attaches the failure
  handler the two fire-and-forget call sites are missing: the rejection is logged at debug and
  absorbed. `startAdd` and `retryAdd` go through it.
- Nothing else changes. `runAdd` still records the failure on both records before re-throwing, `add`
  still awaits and still throws to its caller, and the sub-steps, their timings, the captured output
  and the retry rules are all untouched.
- A test drives a failing detached add with a `process.on('unhandledRejection')` listener installed
  and asserts the job records the failure while nothing escapes.

### Why not a `stop()` drain, as VS-44 added to the ticket service

VS-44's detached work is a 50 ms and a 100 ms timer, so awaiting it at shutdown costs nothing. A
project add is minutes of `git clone` (a 900 s timeout). A daemon that awaited an in-flight add
before closing its database would hang for as long as the clone takes. The existing design already
covers the interrupted case: `setup-jobs` requires the daemon to settle every job left `running` by a
previous process at startup, and the project it was adding is left retryable. So the fix here is
containment only.

## Capabilities

### New Capabilities

<!-- none -->

### Modified Capabilities

- `workspace-setup/setup-jobs`: adds the guarantee that the detached add behind the immediate answer
  is best-effort — its failure lands on the job and the project row and in the log, and never as an
  unhandled rejection in the daemon process.

## Impact

- `packages/core/src/projects/index.ts` — the `detach` helper and the two call sites.
- `packages/core/src/projects/projects.test.ts` — the containment test.
- No API route, no wire shape, no database schema, no interface and no agent-facing tool changes.

## Out of scope

- Detached work outside the projects service.
- `configFor` (`packages/core/src/projects/index.ts:118`) throwing a `ZodError` when a project that
  failed *before* the `declare` sub-step is retried: the row's `openspecEnabled` is SQLite's `0`/`1`
  and `ProjectConfigSchema` wants a boolean. A separate defect, found while writing the test for the
  detached retry path — it makes `retryAdd` throw synchronously (a 500, not an unhandled rejection),
  so it is not what this change is about. Reported on the ticket for the conductor to route.
- Draining or cancelling an in-flight add at shutdown (see above).
- Changing what the add pipeline does, or the retry rules around it.
