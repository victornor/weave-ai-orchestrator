## 1. Wake queue: the self-scheduled source and service

- [x] 1.1 Add `self_scheduled` to `WAKE_SOURCES` in `packages/shared/src/enums.ts`; verify `pnpm typecheck` and the existing `packages/core/src/wake/wake.test.ts` pass.
- [x] 1.2 Add `packages/shared/src/self-wake.ts` exporting `SELF_WAKE_MIN_DELAY_MS` (1 min), `SELF_WAKE_MAX_DELAY_MS` (24 h) and `SELF_WAKE_STALL_GRACE_MS` (1 min), export it from `packages/shared/src/index.ts`; verify typecheck.
- [x] 1.3 Add `scheduleSelfWake(agentId, { reason, delayMs, requestedBy })` and `pendingSelfWake(agentId)` to the `WakeService` interface (`packages/core/src/api.ts`) and implement them in `packages/core/src/wake/index.ts`: bounds validation, cancel-and-clear-key of the agent's queued `self_scheduled` wakes, direct queued insert with `notBefore` and idempotency key `self-wake:<agentId>`, `wake.queued` event and activity record; update `fakeWake` in `packages/core/src/testing/context.ts`; verify new `wake.test.ts` cases: a 20-minute schedule yields one queued `self_scheduled` wake with the reason and `notBefore` ≈ now+20m, a second schedule leaves exactly one wake at the new time/reason, and delays below the minimum / above the maximum / in the past are rejected.
- [x] 1.4 Add a dispatcher test proving a self-wake with future `notBefore` is not claimed, and is claimed with the reason once the time passes (`packages/core/src/runs/dispatcher.test.ts` or the engine harness); verify it fails against the old dispatcher if `notBefore` were ignored.

## 2. The worker tool

- [x] 2.1 Add `'weave_schedule_wakeup'` to `WORKER_ONLY_TOOLS` in `packages/shared/src/tools.ts`; verify `packages/shared/src/tools.test.ts` passes and `toolNamesFor('worker')` contains it while `toolNamesFor('weaver')` does not.
- [x] 2.2 Define the tool in `packages/server/src/tools.ts` (`scope: 'worker'`), input `{ reason, delayMinutes?, at? }` with exactly-one-of and future-instant validation, handler calling `svc(ctx).wake.scheduleSelfWake(ctx.claims.agentId, ...)`; verify a server test asserts a successful call, a second call replacing the first, an input naming another agent still scheduling for the caller, and the weaver's call failing `forbidden`.

## 3. Instructions and runtime denial

- [x] 3.1 Update `skills/weave-ai-worker/SKILL.md` (turn loop / "Only claim a monitor…" area) and `templates/worker.AGENTS.md.tmpl` to name `weave_schedule_wakeup` as the way to check on something later and state the runtime's own scheduling tools die with the turn; verify `packages/shared/src/tools.test.ts` passes and a render/content assertion finds the tool name and the warning.
- [x] 3.2 Add an optional `workerDeniedTools?: string[]` to `RuntimeAdapter` (`packages/runtime-sdk/src/index.ts`) and declare `['ScheduleWakeup', 'CronCreate', 'CronList', 'CronDelete']` on the Claude adapter; verify the adapter's args test asserts `--disallowedTools` carries those names for a worker turn.
- [x] 3.3 Union the adapter's `workerDeniedTools` into `input.permission.deniedTools` in `packages/core/src/runs/engine.ts` only for worker runs; verify an engine test asserts the denied list contains the scheduler tools for a worker and does not for the weaver, and that a role's own denied tools are preserved.

## 4. Visibility

- [x] 4.1 Report the pending self-wake (scheduled time and reason) on the worker views: add it to `workerView` (`packages/server/src/inspect.ts`), to `weave_worker_list` and `weave_worker_get` (`packages/server/src/tools.ts`); verify server tests assert it appears while queued and disappears once the wake is claimed or replaced.
- [x] 4.2 Attach the pending self-wake to `GET /workers` and `GET /workers/:id` (`packages/server/src/routes/workers.ts`); add `scheduledWake` to `WorkerListItem`/`WorkerDetail` in `packages/ui/src/api/hooks.ts` and render it on `WorkerCard`/`WorkerRow` (`packages/ui/src/components/WorkerCard.tsx`); verify a UI test renders the scheduled time and reason for a worker that has one and nothing for one that does not.

## 5. Supervisor

- [x] 5.1 Change the wakeup clause in `stalledWorkers()` (`packages/core/src/supervisor/index.ts`) per design: a claimed wake always counts; a queued non-`self_scheduled` wake always counts; a queued `self_scheduled` wake counts only while `not_before > now - SELF_WAKE_STALL_GRACE_MS`; verify new `supervisor.test.ts` cases: idle with a future self-wake not stalled, idle a moment past the self-wake not stalled, idle well past the self-wake stalled.
- [x] 5.2 Confirm the worker-stalled spec delta (`openspec validate` later) still matches the query, including that detection never enqueues a wake, retry or restart.

## 6. Docs

- [x] 6.1 Update `docs/PLAN.md`: add `self_scheduled` to the §7.1 wakeups source list and the §7.1 wake-source table (a worker scheduled its own next wake), and add `weave_schedule_wakeup` to the §9.2 worker tool surface.
- [x] 6.2 Update `docs/API.md`'s MCP section to describe `weave_schedule_wakeup` (worker-only, bounds, replace, caller-only) and the `scheduledWake` field on the worker list/get and inspection responses.

## 7. Verification

- [x] 7.1 Run `pnpm lint`, `pnpm typecheck` and both suites (`pnpm test`, then `pnpm --filter @weave-ai/ui exec vitest run`); paste both suite blocks verbatim with their totals in the delivery report.
- [x] 7.2 Run `openspec validate vs-317-a-worker-s-scheduled-wakeup-never-fires --json --strict` and confirm it is clean before requesting `proposed`.
