# Tasks

- [x] 1. In `packages/core/src/runs/dispatcher.ts`, order a candidate whose latest run ended
  `interrupted` with `error_code = 'interrupted_by_shutdown'` ahead of never-run workers, after the
  weaver and before the existing `last_run_at` fairness order; verify with a dispatcher test that with
  the run limit full an interrupted worker and a never-run worker both queued, the interrupted one is
  dispatched first when a slot frees, and the weaver still goes first.
- [x] 2. Add `queuedForCapacity` to `RestartNotice` (`packages/shared/src/types.ts`) and a pure
  `queuedForCapacity(turns, limits)` in `packages/server/src/restart-notice.ts` that returns the
  interrupted turns beyond the run limit (less the weaver's slot) or a project's `maxWorkers`, in
  dispatch order; have `announceRestart` fill it and `restartNoticeText` say how many are waiting.
- [x] 3. In `packages/core/src/workers/index.ts`, detect a queued wake preserved from a shutdown
  (`interrupted_by_shutdown`) on relaunch, and return the worker with a `notice` ("already queued;
  waiting for a run slot") without bumping the brief, re-rendering the home or enqueuing a wake;
  surface the same in the `weave_worker_relaunch` tool description.
- [x] 4. Tests: the dispatcher ordering; the restart payload/line lists the turns queued for capacity;
  relaunching a worker with a preserved queued wake reports the note and starts nothing.
- [x] 5. Add the `queuedForCapacity` clause to the restart-wake paragraph in
  `templates/weaver.AGENTS.md.tmpl` and `skills/weave-ai-weaver/SKILL.md`.
- [x] 6. `openspec validate vs-375-turns-a-daemon-restart-cut-off-wait-behi --json --strict`, then
  `pnpm lint`, `pnpm typecheck` and both suites green; paste both suite blocks in the report.
