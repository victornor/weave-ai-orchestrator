## 1. Wake queue: pause holds the turn, not the wake

- [x] 1.1 In `packages/core/src/wake/index.ts` Gate 2, stop skipping a worker whose role is `paused`. Leave `agent_paused` / `agent_retired` / `agent_done` / `role_retired` / workspace-not-active as skips. Invert `packages/core/src/wake/wake.test.ts` `'skips a worker whose role is paused'` so enqueue returns `queued` with no `skipReason` when the role is paused.

- [x] 1.2 In the same Gate 0 lookup, ignore rows whose status is `skipped`, `cancelled`, or `failed`. A later enqueue of that key MUST insert a new `queued` wake. Add tests in `wake.test.ts`: (a) skipped key then enqueue while able to run → new queued wake; (b) existing queued/completed key still returns the original row.

## 2. Dispatcher: do not claim while the role is paused

- [x] 2.1 In `packages/core/src/runs/dispatcher.ts` `tick`, skip a worker whose role is not `active` *before* `claim` (same shape as the `needs_login` filter — do not claim then abort). A wake for that worker stays `queued`. Add a test next to `dispatcher.isolation.test.ts`: role paused → enqueue → `tick` → zero runs, wake still `queued`; `roles.resume` (or a direct `roles.status = 'active'` write) → `tick` → a run is claimed.

## 3. Acceptance journeys

- [x] 3.1 Pause → approve → resume → apply starts. Real `createWakeService` + `createDispatcher` (fake runtime). Seed a `change` ticket with a live worker, pause the role, transition the ticket to `approved` (or call the same `wake(..., 'ticket_assigned', 'plan approved …')` path `transition` uses), assert the wake is `queued` and no run starts, resume the role, `tick`+`drain`, assert a run was dispatched for that worker. Covers `run-recovery/role-pause-wakes` scenarios "Plan approved while the role is paused" and "Role paused, plan approved, role resumed, apply starts".

- [x] 3.2 Propose on runtime A, approve after switching to B, apply starts on B. Seed a worker that has an active session on runtime A, change `ctx.config.models.workers.runtime` to B, enqueue the plan-approved wake (role active), `tick`+`drain`. Assert a run is dispatched with `runtimeId` B, and `sessions.forTurn` retires the A session (status `stale`, no A handle passed). Covers `model-selection/turn-resolution` "Propose on runtime A, approve after switching to runtime B". Existing session tests may already pin retirement; this task is the missing "the apply turn actually starts" half.

## 4. Plan text and verification

- [x] 4.1 Update `docs/PLAN.md` §7.1 Gate 2 so a paused role leaves the wake queued and the dispatcher does not claim it, instead of `skip (role_paused)`. Remaining skip reasons unchanged.

- [x] 4.2 Run `pnpm lint`, `pnpm typecheck`, and `pnpm test`. All three green, including the new tests in 1.1, 1.2, 2.1, 3.1 and 3.2.
