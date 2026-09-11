# ADR 0018 — Routines are conductor alarms, not ticket templates

**Status:** accepted · 2026-09-11 · VS-220 / PLAN §6.1 `routines`

## Context

The `routines` table has been in the schema since init, with `trigger_json` sketched as cron-or-webhook and `template_json` sketched as a ticket template. Captain asked for periodical work as **alarms that wake the conductor with an instruction**, not a second scheduler agent and not a ticket factory.

`wake.enqueue` already exists. Pre-arming a future fire with `notBefore` would land in Gate 3's coalescing of currently-eligible queued wakes, so a due-now enqueue is the contract.

## Decision

- **`template_json` is `{ instruction, action, maxTicketsPerFire, projectId? }`**, not a ticket template. `action` is `report` (default: look, then reply to captain) or `file_work` (the only filing licence). Cap `maxTicketsPerFire` ≤ 8.
- **No cron. No webhooks.** Schedule is daily wall-clock in an IANA zone, or `everyMinutes` ≥ 15.
- **Always the conductor.** `role_id` is unused/null. Fires go through `wake.enqueue({ source: 'routine' })` when `next_fire_at <= now`.
- Human-facing name is **Scheduled tasks**; HTTP/CLI/MCP identifiers stay `routines` / `routine`.

## Consequences

- Captain's example routines are definitions they add later, not part of this change.
- A `report` fire that is the turn's only wake cannot file tickets (`tickets.create` is `forbidden` after walking `flattenWakes`).
- Overlap is `skip_if_active` via `in_flight_wake_id`. A paused conductor does not advance `next_fire_at`.
