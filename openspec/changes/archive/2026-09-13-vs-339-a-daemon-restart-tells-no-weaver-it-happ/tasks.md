## 1. The shutdown signal

- [x] 1.1 Add `shuttingDown: { reason: string; at: string } | null` to `RunRuntimeState` in `packages/core/src/runs/active.ts` and initialise it to `null`; verify `pnpm typecheck` compiles the package.
- [x] 1.2 Add `beginShutdown(reason: string): void` to the `Dispatcher` interface (`packages/core/src/api.ts`) and implement it in `packages/core/src/runs/dispatcher.ts` to set `shuttingDown` and `stopping` synchronously; have `start()` clear both. Verify with a dispatcher test that `beginShutdown` sets the mark before any await and `start()` clears it.
- [x] 1.3 Update any test fakes of `Dispatcher`/`WorkspaceRuntime` that now fail typecheck (`pnpm typecheck` and `pnpm lint` green).

## 2. Finalize takes the shutdown signal

- [x] 2.1 In `packages/core/src/runs/engine.ts` `finalize`, classify as `interrupted` with `errorCode: 'interrupted_by_shutdown'` when `runState(ctx).shuttingDown` is set and the run did not succeed, taking precedence over the runtime-error and exit-code branches; leave a run that succeeded as `succeeded`. Verify in `engine.test.ts` with a fake runtime result of exit 143 carrying an `error` during a marked shutdown, and with exit 1 during a marked shutdown, both expecting `interrupted` and `interrupted_by_shutdown`.
- [x] 2.2 Verify a genuine failure without the mark is unchanged: an exit-143-with-error result with no shutdown mark stays `failed` with its runtime code, and a human `interrupt` cancel keeps `interrupted` without the shutdown code.
- [x] 2.3 Re-queue the run's wakes and leave its worker `active` on a shutdown interrupt (the `preserveWake` branch and the `agentStatus` expression), just as boot recovery does for an orphaned run. Verify in `engine.test.ts` that the interrupted run's wake reads back `queued` with no `runId`, and the agent is `active`, with no `retry_approval` decision created.
- [x] 2.4 Cover the deferred upgrade's drain-and-restart, not only a plain stop: a run left executing when the upgrade's wait for idle expires is `interrupted_by_shutdown` and queued to resume once the restart's signal sets the mark. Verify with a test that drives `upgrade.ts`'s wait-expiry plus the restart mark and asserts the run is not parked; note in the report if this needs the daemon-level harness rather than a unit fixture.

## 3. The durable lifecycle record

- [x] 3.1 Add `packages/server/src/restart-notice.ts` with `observeBoot`, `markBooted`, `recordShutdown` and `recordStartFailure` over the daemon database's `meta` table under `daemon.lifecycle.*`, and a pure `restartNoticeText` / `restartNoticeReason` pair. Verify unit tests cover: clean restart (`shutdown_at >= previous boot_at`), crash (no `shutdown_at` after the last boot), a failed start counted with its last reason and a successful boot resetting the count, and the first boot (no previous record).
- [x] 3.2 Wrap the startup in `packages/server/src/daemon.ts` after the daemon database is opened so a thrown start error calls `recordStartFailure` and rethrows. Verify a test that drives `startDaemon` to fail on its listener (a port already bound) leaves a failed-start record that the next `observeBoot` reports.
- [x] 3.3 In `shutdown()` (`packages/server/src/daemon.ts`) call `beginShutdown(reason)` on every workspace and `recordShutdown(...)` synchronously, before the first `await`. Verify a daemon-shutdown test that after `stop()`, the daemon database records the shutdown reason, and a run still executing is finalized `interrupted_by_shutdown` and its wake queued.
- [x] 3.4 Call `beginShutdown` in `POST /api/daemon/drain` (`packages/server/src/routes/daemon.ts`) before it stops and cancels, and confirm `undrain`'s `dispatcher.start()` clears the mark. Verify a route test that a run cancelled inside the drain is `interrupted_by_shutdown` and resumes after `undrain`.

## 4. The restart notice

- [x] 4.1 Add `RestartNotice` (kind `daemon.restarted`, boot/down instants, `clean`, `failedStarts`, and the interrupted worker/ticket/run list) to `packages/shared/src/types.ts`; verify `pnpm typecheck`.
- [x] 4.2 Implement `announceRestart(...)` in `restart-notice.ts`: read each workspace's runs created since the previous boot that are `interrupted` with `error_code = 'interrupted_by_shutdown'` or still `running`, joined to their agent and ticket; post the one short line through `threads.notifyHuman`; enqueue one `source: 'system'` wake to the workspace's weaver with idempotency key `daemon.restarted:<bootAt>`. Verify with a fake-workspace fixture, as `upgrade-announce.test.ts` does, that a clean restart produces one line and one wake per workspace naming the interrupted turns, and a crash reports `clean: false`.
- [x] 4.3 In `packages/server/src/daemon.ts`, observe the lifecycle at boot, mark the boot once serving, and call `announceRestart` only when the boot's release equals the previously recorded release (the first boot and an upgrade restart post nothing). Verify tests that a release change suppresses the notice, the first boot posts nothing, and a same-release restart posts.
- [x] 4.4 Confirm an upgrade restart still produces exactly its `daemon.upgraded` wake and line and no `daemon.restarted` wake; verify against the existing `upgrade-announce.test.ts` fixture plus the release-comparison path.
- [x] 4.5 Verify announcing one boot twice enqueues one wake (the idempotency key), with a test calling `announceRestart` twice for the same observation.
- [x] 4.6 Derive the `daemon.upgraded` announcement's `interrupted` and `resumed` counts from the records — the runs the restart recorded `interrupted_by_shutdown` in the upgrade's window, and the queued wakes named by those runs' `wakeup_ids_json` — instead of `interrupted_runs` and the workspace-wide queued-wake count. Verify in `upgrade-announce.test.ts` that the counts match the recorded interruptions and exclude a turn that finished before the restart and an unrelated queued wake; add the fact(s) to `AnnouncementFacts`.

## 5. Instructions and end-to-end

- [x] 5.1 Add a short restart-wake paragraph to `templates/weaver.AGENTS.md.tmpl` beside the upgrade-wake item (renumbering the turn list) and the same to `skills/weave-ai-weaver/SKILL.md`; verify the rendered template contains the `daemon.restarted` description and stays under the template's 200-line target.
- [x] 5.2 Run `openspec validate vs-339-a-daemon-restart-tells-no-weaver-it-happ --json --strict` and fix any item.
- [x] 5.3 Run `pnpm lint && pnpm typecheck && pnpm test` and paste both suite blocks verbatim in the report; the fix touches core and server, so both must be green.
