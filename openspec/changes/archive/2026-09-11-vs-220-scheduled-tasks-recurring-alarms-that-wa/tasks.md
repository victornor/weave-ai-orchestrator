## 1. Shared types, schema and schedule math

- [x] 1.1 Add routine types and enums to `packages/shared` (status `active`|`paused`, action `report`|`file_work`, trigger shapes daily/interval, `Routine`, `RoutineUsage`). Add `ac_routine_list`, `ac_routine_create`, `ac_routine_update`, `ac_routine_remove` to `CONDUCTOR_TOOLS`. Verify shared tests include the enum values and that `CONDUCTOR_TOOLS` contains the four names.
- [x] 1.2 Add migration `0024_routines_engine.sql` adding `in_flight_wake_id` and `updated_at` to `routines`. Verify `packages/db` migration tests create the columns and can insert an active row with `trigger_json` / `template_json`.
- [x] 1.3 Implement `nextAfter(schedule, fromInstant)` in `packages/core/src/routines/schedule.ts`. Verify unit tests: daily 07:00 Europe/Copenhagen vs UTC around a DST spring-forward; interval 60 minutes from a known instant; unknown timezone throws `validation`; `everyMinutes < 15` is rejected at parse.

## 2. RoutinesService and firing

- [x] 2.1 Implement `RoutinesService` CRUD (create, list, get, update/pause/resume, remove) against the workspace `routines` table, defaulting action to `report` and `maxTicketsPerFire` to 0 or 3, rejecting cap > 8 and webhook/cron triggers. Verify unit tests cover create-default-report, pause does not fire, resume arms a future slot, remove deletes, edit instruction is stored.
- [x] 2.2 Implement `fireDue(now)`: enqueue `source: 'routine'` via existing `wake.enqueue` with current instruction in the payload; set `last_fired_at`, `in_flight_wake_id`, `next_fire_at = nextAfter(schedule, now)` in the same transaction; skip when paused, removed, or in-flight. Verify a due routine produces exactly one conductor wake with source `routine` and no other queue is written.
- [x] 2.3 Missed-fire test: set `next_fire_at` to Monday 07:00, run `fireDue` at Wednesday 10:00 → exactly one wake and `next_fire_at` is Thursday 07:00; a second `fireDue` before the wake is cleared enqueues none.
- [x] 2.4 Overlap test: after a fire, leave `in_flight_wake_id` pointing at a queued/claimed wake, advance past the next slot, `fireDue` enqueues none; on run finalize, snap `next_fire_at` forward without enqueueing. Verify no second wake exists.
- [x] 2.5 Paused-conductor skip: `wake.enqueue` returning `skipped`/`agent_paused` MUST NOT advance `next_fire_at` or set in-flight. Verify the next `fireDue` retries.
- [x] 2.6 Wire `RoutinesService` onto `CoreServices` / `createCoreServices`. Call `fireDue` from the supervisor tick every pass (not a 10-minute gate). On run finalize, clear matching `in_flight_wake_id` and snap a past `next_fire_at` forward. Verify a supervisor test with a due routine enqueues a conductor wake.

## 3. Ticket cap, spend, HTTP, MCP

- [x] 3.1 In `tickets.create`, reject a create as `forbidden` only when `flattenWakes` of the run's claimed wakes are exclusively `report` routine fires (no other source of any kind). For `file_work`, count tickets with `origin_kind=routine` and fingerprint prefix `routine:<id>:` created this run plus still-open ones; reject over `maxTicketsPerFire`. Verify tests: a lone report fire cannot file; a report fire coalesced with a digest or ticket-event wake can file; file_work cap 3 rejects the fourth.
- [x] 3.2 Add `routines.usage(id, window)` summing conductor-turn usage for that routine's fires plus originated-ticket usage. Verify a fire's run cost and a child ticket's cost both appear, and a never-fired routine returns zeros.
- [x] 3.3 HTTP: `GET/POST /api/w/:ws/routines`, `GET/PATCH/DELETE /api/w/:ws/routines/:id`, `GET /api/w/:ws/routines/:id/usage`. Session auth. Document in `docs/API.md` and `routetable.ts`. Verify list empty; create+list; pause via PATCH; worker run token rejected; usage window query.
- [x] 3.4 MCP: register the four conductor-only tools. `ac_inbox` gains a `routines` bucket for `source === 'routine'`. Verify a conductor tool-call creates a row, a worker call is rejected with no row, and `ac_inbox` after a fire lists the instruction under `routines`.

## 4. CLI, Settings, prompts, PLAN

- [x] 4.1 `conductor routine list|show|add|pause|resume|rm` with `--daily HH:MM` / `--every <minutes>` / `--tz` / `--instruction` / `--action` / `--max-tickets` / `--project`. Verify CLI tests against the HTTP fake: add then list shows it; pause then list shows paused.
- [x] 4.2 Settings: add `{ key: 'scheduled', label: 'Scheduled tasks', area: 'workspace' }` to `SETTINGS_SECTIONS`. Build the section: list name/schedule/status/next due/7d spend, add form, pause/resume/remove, empty state. Verify `settingsScopes.test.tsx` places Scheduled tasks in the workspace area, and `scheduledSettings.test.tsx` covers empty wording, a listed routine, pause control, and spend including zero.
- [x] 4.3 Conductor prompt + skill: a `routine` wake is an alarm; default is report to captain; `file_work` is the only filing licence; honour the cap. ADR 0018 (template_json is instruction+action, not a ticket template; no cron; always conductor). Update PLAN §6.1 routines row, §7.1 already has the source, §20 CLI. Verify those files name the tools and the report-default rule.
- [x] 4.4 `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm --filter @agent-conductor/ui exec vitest run` are green. Post the actual output on the ticket.
