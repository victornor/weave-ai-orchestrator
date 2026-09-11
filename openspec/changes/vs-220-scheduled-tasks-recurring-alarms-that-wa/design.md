## Context

See `proposal.md`. Constraints that shape the approach:

- PLAN §6.1 already named the entity `routines` and the wake source `routine`. Migration `0001_init.sql` already created `routines (id, workspace_id, name, trigger_json, template_json, role_id, concurrency, status, last_fired_at, next_fire_at, created_at)`. Nothing reads or writes it. `jobs` is a different thing (workspace-setup progress, VS-37) and MUST NOT be reused.
- `wake.enqueue` is the only funnel. Gate 3 coalesces a new wake into any currently-eligible queued wake whose `notBefore` is ≤ the new wake's. Pre-arming a fire hours ahead with `notBefore` would dump it into whatever conductor turn is already queued. Decision reminders and retries only survive this because they enqueue against an idle agent.
- Knowledge curation is a supervisor sweep that files tickets. Recurring captain-facing work must not copy that — VS-213. Captain, 2026-09-11: wake the conductor with the instruction.
- PLAN's `template_json` as a ticket template is the ticket-factory shape. Deviations from PLAN go in `docs/adr/` (`CLAUDE.md`).
- Changelog already does IANA timezones (`Intl.DateTimeFormat`). Host timezone is `Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'`.
- Isolated-daemon dispatch (`daemon-isolation/dispatch-gate`) will leave a `routine` wake queued until a human-requested wake arrives. Acceptable: isolated daemons are throwaway; the live workspace is not isolated.
- `ac_inbox` already puts unknown sources in `other`; `flattenWakes` already walks `payload.bundle`. A `routine` fire that coalesces into a human-message turn is visible if the inbox walks `other`.

## Goals / Non-Goals

**Goals:**

- Implement the existing `routines` row as the recurring definition; fire by `wake.enqueue({ source: 'routine' })`; re-arm `next_fire_at`.
- Human-facing name "Scheduled tasks"; PLAN identifiers (`routines`, `routine`, `conductor routine`) in code, HTTP, CLI and MCP.
- Miss, overlap, report-default, fan-out cap, and spend as specified.

**Non-Goals:**

- Webhook / `POST /routines/:publicId/fire` (PLAN: M6).
- Cron expression parser; weekly/monthly calendars; one-shot alarms (interval covers "a timer").
- A second scheduler agent, a new wake table, or reuse of `jobs`.
- Budgets, automatic pause-on-spend, or changing `maxConcurrentRuns`.
- TUI / Telegram management (HTTP + CLI + Settings + conductor chat).
- Writing captain's example routines (investigate issues / tickets / incidents) — those are later definitions.
- Changing coalescing for unrelated future-`notBefore` wakes; we avoid that path.

## Decisions

### D1. Reuse the `routines` table; do not add `scheduled_tasks`

PLAN identifiers win. A migration (`0024_routines_engine.sql`) widens the existing table:

- `trigger_json` stays. Shape for v1: `{ kind: 'schedule', timezone: IANA, daily: { hour, minute } }` or `{ kind: 'schedule', timezone: IANA, everyMinutes: N }`. Reject `kind: 'webhook'` and any `cron` string (`validation`).
- `template_json` stays. Shape for v1: `{ instruction, action: 'report' | 'file_work', maxTicketsPerFire, projectId? }`. This is the ADR: not a ticket template.
- Add `in_flight_run_id TEXT` (nullable). Add `updated_at`. Keep `role_id` unused (null = conductor; targeting a worker is out of scope).
- `concurrency` stays, default `skip_if_active`. v1 only honours that value; `always` / `coalesce_if_active` are rejected on write.

**Rejected:** a new table (duplicates PLAN). **Rejected:** stuffing this into `jobs` (wrong lifecycle). **Rejected:** full cron in v1 (timezone-naive cron is how "07:00" becomes 08:00 after DST; daily+interval cover captain's examples).

### D2. Fire from a supervisor pass, not a pre-armed `notBefore` wake

`RoutinesService.fireDue(now)` runs on every supervisor tick (15 s; same pattern as curation). For each `active` row with `next_fire_at <= now` and `in_flight_run_id` null:

1. Read the current definition (instruction SoT).
2. In one transaction: `wake.enqueue(conductorId, { source: 'routine', reason, payload: { routineId, name, instruction, action, maxTicketsPerFire, projectId }, idempotencyKey: 'routine:' + id + ':' + nextFireAt })`; set `last_fired_at = now`, `in_flight_run_id =` the wake's eventual run is not known yet — store the **wake id** until claim, then the run id. Simpler: store `in_flight_wake_id` until the dispatcher claims, OR treat "a queued or claimed `routine` wake for this id" as in-flight and skip a column.

Chosen: **`in_flight_wake_id`** on the row. Overlap = that wake is `queued` or `claimed` (and its run, if any, is not terminal). On `runs.engine` finalize of a run whose claimed wakes include this routine, clear `in_flight_wake_id` if it matches. If the wake was skipped (`agent_paused`, workspace paused), clear it and leave `next_fire_at` in the past so the next tick retries — a paused conductor must not kill the schedule (same spirit as VS-154: queue, don't skip-and-forget). Gate 2 currently **skips** a paused conductor; a skipped `routine` wake would lose the fire. **Mitigation:** `fireDue` calls `enqueue`; if the returned row is `skipped` because `agent_paused`, do not advance `next_fire_at` and do not set in-flight — retry next tick. If skipped because `workspace_paused`, same. Other skip reasons: log and still advance (retired conductor is a real incident).

Do **not** pass a future `notBefore`. The due check is `next_fire_at`. A due-now enqueue may coalesce into a currently queued conductor wake (Gate 3) — that is one turn seeing both the chat message and the alarm, which is correct.

Re-arm: in the same transaction as a successful (queued or coalesced) enqueue, set `next_fire_at` to the next scheduled instant **strictly after now**. Coalesced still counts as fired.

**Rejected:** pre-arm with `notBefore` (Gate 3 coalescing landmine). **Rejected:** a dedicated 1 s timer (supervisor already ticks).

### D3. Next-fire arithmetic (miss vs overlap)

Pure functions in `packages/core/src/routines/schedule.ts`, so the outage test does not need a running dispatcher:

- `nextAfter(schedule, fromInstant) → ISO` — first occurrence strictly after `fromInstant`.
- Daily: date-fns-style via `Intl` in the named zone; hour/minute on the next local calendar day if today's local time is already past. DST: 07:00 is 07:00 local (changelog's `dayKey` pattern).
- Interval: `fromInstant + N minutes`.
- Missed: `fireDue` fires once when `next_fire_at <= now`, then `next_fire_at = nextAfter(schedule, now)`. Several missed days → one late fire. Test: set `now` to Wednesday 10:00, `next_fire_at` to Monday 07:00, `fireDue` once → one wake, `next_fire_at` Thursday 07:00; `fireDue` again → zero wakes.
- Overlap: `in_flight_wake_id` set → skip, leave `next_fire_at` as already-advanced value. When the in-flight wake's run terminates, if `next_fire_at` is still in the past (the overlapped slot), snap it forward with `nextAfter(schedule, now)` **without** enqueueing. Test: fire, leave the wake `claimed` with a running run, advance past the next slot, `fireDue` → 0; finalize → still 0, `next_fire_at` in the future.

### D4. Action policy and fan-out live on the definition; filing is origin-tagged

`template_json.action` defaults `report`. `maxTicketsPerFire` defaults 0 / 3, hard max 8.

Wake payload carries `action` and `maxTicketsPerFire`. Conductor prompt + skill: a `routine` wake is an instruction to look; reply to captain; do not file unless `action === 'file_work'`, and then at most `maxTicketsPerFire`.

`tickets.create` is `forbidden` only when `flattenWakes` of the run's claimed wakes are **exclusively** `report` routine fires — every entry `source === 'routine'` and action `report`, nothing else of any source. A lone alarm cannot file; a fire that coalesced into a digest, a ticket event, a decision, or a human message does not disarm the conductor. Walk `flattenWakes`, not raw wake rows: Gate 3 stores a coalesced routine under `payload.bundle`, so a top-level `source` of `system` with a bundled `routine` is mixed work and must be allowed. **Rejected:** "any `report` routine and no `human_message`" — that would have refused VS-218, which was filed from a digest turn with no human message. `file_work` present → the cap below applies instead of this forbid.

Hard cap: `tickets.create` with `originKind === 'routine'` counts tickets whose `origin_fingerprint` starts with `routine:<id>:` and whose `created_run_id` is this run (this fire) **plus** any still-non-terminal ticket with that prefix. Exceeding `maxTicketsPerFire` → `OcError('validation', …)`. Fingerprint: `routine:<id>:<stable-key>` for dedupe of the same work item (PLAN's partial unique on origin while non-terminal already exists); the cap counts distinct tickets, not fingerprint collisions.

The fire itself never inserts a ticket.

### D5. Spend is a usage query, not a new events table

Do not add `scheduled_task_id` to `usage_events` (PLAN #19: no budgets; usage already has run/ticket).

- Conductor-turn spend: `usage_events.run_id` IN runs whose claimed wakes have `source = 'routine'` and `payload.routineId = :id`.
- Originated-ticket spend: `usage_events.ticket_id` IN the subtree of tickets with `origin_kind = 'routine'` and `origin_fingerprint LIKE 'routine:' || :id || '%'`.

`GET /routines/:id/usage?window=24h|7d` reuses `resolveUsageWindow`. Settings shows the 7 d figure. `ac_usage` is unchanged; this is a per-routine rollup only.

### D6. Surfaces: HTTP + CLI + Settings + conductor MCP

Workspace-scoped, session auth:

- `GET/POST /api/w/:ws/routines`
- `GET/PATCH/DELETE /api/w/:ws/routines/:id`
- `GET /api/w/:ws/routines/:id/usage`

PATCH pause/resume is `{ status: 'paused' | 'active' }`. Resume recomputes `next_fire_at = nextAfter(schedule, now)`.

CLI: `conductor routine list|show|add|pause|resume|rm` (PLAN §20 has no verb yet; add it). `add` flags: `--name`, `--daily HH:MM` or `--every <minutes>`, `--tz`, `--instruction`, `--action report|file_work`, `--max-tickets`, `--project`.

MCP (conductor-only, `CONDUCTOR_TOOLS`): `ac_routine_list`, `ac_routine_create`, `ac_routine_update`, `ac_routine_remove`. Workers hitting them → existing conductor-only 403. Create from chat is the path captain will actually use.

Settings: new section `{ key: 'scheduled', label: 'Scheduled tasks', area: 'workspace' }` after presentation. List + add form + pause/resume/remove. Empty state is copy, not an error. Tests extend `settingsScopes.test.tsx` and a new `scheduledSettings.test.tsx`.

### D7. Prompt and inbox

- `ac_inbox`: treat `source === 'routine'` as `other` (already) is enough if `other` is what the conductor reads; **also** add a `routines` bucket so a fire is not buried. Small change to `tools.ts` switch. Payload already has the instruction.
- `templates/conductor.AGENTS.md.tmpl` and the conductor skill: a `routine` wake is an alarm; default report; `file_work` is the only filing licence; honour the cap; do not invent more routines unless captain asked.
- PLAN §7.1 table already maps `routine` → "routine fired". Update §6.1 `routines` row and §20 CLI. ADR 0018 records the template_json / no-cron / conductor-target deviations.

### D8. Isolated daemon and paused conductor

Document, don't special-case isolated: fires stay queued until a human message. On the live workspace they dispatch immediately.

Paused conductor: D2 retries without advancing. Workspace paused: same (`wake.enqueue` skips `workspace_${status}`).

## Risks / Trade-offs

- [Gate 3 coalesces a due fire into a chat turn] → accepted; one turn, inbox shows both. Instruction is on the bundled payload; `flattenWakes` already walks it.
- [Paused conductor skips the wake and we advanced `next_fire_at`] → D2 does not advance on `agent_paused` / `workspace_*` skip.
- [Conductor files tickets on a lone `report` fire] → D4: `tickets.create` is `forbidden` only when flattened claimed wakes are exclusively `report` routine fires. A digest, ticket event, decision, or human message on the same turn keeps filing. Prompt still says report-by-default. `file_work` cap unchanged.
- [Fan-out example: one worker per GitHub issue] → cap 8 hard; default 3; Settings shows spend. Not a budget.
- [15 s jitter on "07:00"] → accepted; next due is still that local 07:00, fire is 07:00:00–07:00:15.
- [Empty `role_id`] → v1 always conductor; a later change can target a role without a new table.
- [Existing empty `routines` rows] → there are none in production use (nothing wrote them). Migration is additive. No backfill.

## Migration Plan

Forward-only SQL: `ALTER TABLE routines ADD COLUMN in_flight_wake_id TEXT;` `ADD COLUMN updated_at TEXT;` (and whatever CHECK widening is needed — `routines` is not referenced by FK, so no `foreign_keys_off`). Rollback is revert; leftover columns are unused. Empty table. ADR 0018 lands in the same PR as the engine.

## Open Questions

None. Table vs new name, notBefore vs tick, timezone, miss/overlap, report-default, cap, and surfaces are judgements inside the accepted contract and PLAN identifiers.
