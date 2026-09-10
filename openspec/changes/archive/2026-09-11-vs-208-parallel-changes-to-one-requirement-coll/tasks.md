## 1. Repair VS-205's stale delta (content only)

- [x] 1.1 Bring `openspec/changes/vs-205-empty-rows-pad-the-transcript-one-per-re/specs/
      conductor-chat/turn-work-trace/spec.md`'s MODIFIED requirement up to date: the requirement
      text and all eight scenarios currently in `openspec/specs/conductor-chat/turn-work-trace/
      spec.md` (VS-204's usage/context-window paragraphs and four scenarios, plus the pre-existing
      four), plus VS-205's own new "A tool call with a duplicate companion event" scenario.
- [x] 1.2 Verify with `openspec validate vs-205-empty-rows-pad-the-transcript-one-per-re --strict
      --json`: clean, no issues.

## 2. `cli.archive()` surfaces the real failure (`packages/core/src/openspec/cli.ts`)

- [x] 2.1 Call `run` with `allowFailure: true` in `archive()`. On `!r.ok`, build the error message
      from `firstArray(r.json, ['status', 'issues', 'items', 'results'])`'s `message` fields
      (same extraction `validate()` already does for its `issues` array), joined; fall back to
      `stderr`/exit code only when that array is empty. Throw the same `OcError('internal', ...)`
      shape as today, just with the real detail in the message.
- [x] 2.2 Test: a fake `openspec` binary that exits non-zero with the `status`-array shape
      captured in `design.md` (nothing on stderr) — `archive()` throws with the array's message,
      not an empty one. Keep the existing success-path test passing.

## 3. Reconciliation covers every ticket kind (`packages/core/src/supervisor/index.ts`)

- [x] 3.1 Drop the `kind = 'change'` clause from `reconcileOpenSpecArchives`'s SQL — `t.status =
      'done' AND t.openspec_change_name IS NOT NULL` is already the correct membership test (a
      `scout`/`question` ticket never has a change name).
- [x] 3.2 Test: a `task`-kind ticket, `status = 'done'`, `openspec_change_name` set, its change
      directory present on disk and not yet archived — the sweep calls `archiveAfterMerge` for it.

## 4. Reconciliation archive failures are recorded, not only logged (same file)

- [x] 4.1 In `reconcileOpenSpecArchives`'s `.catch`, in addition to the existing `log.warn`: call
      `deps().tickets.comment(SYSTEM, t.id, <the error message>, 'status')` and wake the conductor
      (`source: 'system'`, `idempotencyKey: `reconcile-archive-failed:${t.id}``) so a standing
      failure notifies once rather than every sweep — the wake system's own idempotency (a
      `queued`/`claimed`/`coalesced`/`completed` wake with the same key wins) already gives that
      for free.
- [x] 4.2 Test: a sweep whose archive attempt fails leaves a comment and wakes the conductor with
      the stable `reconcile-archive-failed:<ticketId>` idempotency key (the "does not renotify on a
      later sweep" half is the wake service's own guarantee, already covered by
      `wake.test.ts`'s "is idempotent on the idempotency key" — the fake wake helper this test file
      uses does not itself dedupe, so re-asserting it here would test the fake, not the fix).

## 5. Catch it before it lands, not just after (skill only, no code)

- [x] 5.1 `skills/agent-conductor-worker/references/delivery.md`: add one step to the merge
      procedure, immediately after rebasing onto the landing branch and before merging — for
      `change` tickets and OpenSpec-tracked `task` tickets, run `openspec validate <change>
      --strict`; treat a failure the same as a rebase conflict (fix the delta against what
      actually landed, re-validate, then merge) rather than merging past it.

## 6. Verify

- [x] 6.1 `pnpm lint && pnpm typecheck && pnpm test` green. (One pre-existing flake hit on the full
      run — `jobs.test.ts`'s "lists a project's jobs newest first...", the documented ULID/
      timestamp-tie flake unrelated to this change; passes in isolation and on a clean full rerun.)
- [x] 6.2 `openspec validate vs-208-parallel-changes-to-one-requirement-coll --strict --json` and
      `openspec validate vs-205-empty-rows-pad-the-transcript-one-per-re --strict --json` both
      clean (the latter confirming task 1's repair still holds after any later edits).
- [x] 6.3 Confirm `openspec/changes/` holds no change this ticket archived itself — archiving stays
      the daemon's job; this PR only makes its next attempt succeed. (`git status` clean; no
      `openspec archive` run from this worktree.)
