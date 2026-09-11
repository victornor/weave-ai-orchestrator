## Why

Captain wants work that repeats on a clock — check today's issues, review completed tickets, look at incidents — without standing at the console to ask each time. `wake.enqueue` already accepts `notBefore`, and the `routines` table plus the `routine` wake source have been in the schema since init, but nothing writes them. The missing piece is a stored recurring definition, something that re-arms after each fire, and a way to see, add, pause and remove them. Captain's own shape is the right one: an alarm that wakes the conductor with an instruction, not a second agent and not a ticket factory.

## What Changes

- Recurring **routines** (PLAN §6.1) become a live workspace entity: create, list, pause, resume, remove; each has a name, a schedule, an instruction, and an enabled state.
- A fire **wakes the conductor** through the existing `wake.enqueue` funnel with source `routine`. No new wake mechanism. The next occurrence is armed after each fire so a daily routine stays daily.
- A missed fire (daemon down at the scheduled instant) **runs once late** and never catch-up-fires the skipped days. An overlapping fire (previous turn still running) does not stack.
- Default outcome of a fire is a **report to captain**. Filing tickets is an explicit opt-in on the routine. Fan-out per fire is capped. Spend of the fire's conductor turn, and of tickets it originated, is attributable to that routine. No budget system.
- Captain manages them from Settings (workspace area), the CLI, and by asking the conductor (conductor-only MCP tools). Workers cannot create routines.
- **ADR:** PLAN's `template_json` as a ticket template is rejected for v1 — that is the VS-213 failure mode. The template holds the instruction and the opt-in action policy. Webhook triggers stay out (PLAN already deferred them to M6).

## Capabilities

### New Capabilities

- `routines/definitions`: stored recurring routines — schedule, instruction, enabled state, CRUD and pause/resume on HTTP, CLI and conductor MCP.
- `routines/firing`: how a due routine becomes a `routine` wake, re-arms, handles a missed fire, and refuses to stack on an in-flight fire.
- `routines/conductor-outcome`: a fire is an instruction to look; default is a report; opt-in filing; fan-out ceiling; cost visible on the routine.

### Modified Capabilities

- `web-settings/settings-scopes`: the workspace area gains a Scheduled tasks section for this workspace's routines.

## Impact

- `packages/shared` — routine types, schedule/action enums, conductor tools, log domain.
- `packages/db` — migration on the existing `routines` table (instruction/action fields, in-flight run, timezone-aware trigger); no new wake table.
- `packages/core` — `RoutinesService` (CRUD, next-fire computation, fire/re-arm); supervisor tick calls `fireDue`; wake source `routine` now has a producer; usage rollup by routine; ticket `origin_kind=routine` for opt-in filing.
- `packages/server` — HTTP CRUD + usage; MCP tools; `ac_inbox` already buckets unknown sources under `other`.
- `packages/cli` — `conductor routine list|show|add|pause|resume|rm`.
- `packages/ui` — Settings section: list, add, pause, resume, remove, last fire, spend.
- `templates/` and conductor skill — what a `routine` wake means; report by default; honour `file_work` and the fan-out cap.
- `docs/PLAN.md`, `docs/API.md`, ADR 0018.
- Tests: service unit including a simulated outage (one late fire, no catch-up), overlap, pause-skips-fire; HTTP; MCP; Settings UI. Full suite, lint, typecheck green.
