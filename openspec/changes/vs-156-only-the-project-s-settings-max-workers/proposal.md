## Why

Captain, 2026-09-09: a project's Settings max-workers value is the only concurrency cap that should stop a new worker spawning. Today spawn also takes `min(role.maxWorkers, project.maxWorkers)`, and hire defaults `role.maxWorkers` to 2. VS-154 sat behind the platform-engineer role's cap of 6 while the project still had room under its Settings value of 10. Captain: "If I have 10 max workers set in my settings for a project, there should be max 10 workers running, right? Like, there's no limit per hire, that makes no sense."

## What Changes

- `workers.spawn` refuses a new worker only when the *project* is at `project.maxWorkers`. It no longer consults `roles.freeSlots` / `role.maxWorkers`.
- `RolesService.concurrency` reports the project cap as the effective limit. `free` is project remaining slots, shared by every role in that project. `freeSlots` matches that, so nothing still treats a role's stored number as a spawn gate.
- The Team role-sheet "max workers" editor and the `{live}/{role.maxWorkers}` list readout go away. Settings' per-project max-workers field remains the control.
- Hire, `ac_role_set_max_workers`, and `conductor role set-max-workers` may still write the stored `role.maxWorkers` field (schema/API compat, no migration), but that write no longer creates a tighter spawn limit. Hire skill and conductor routing stop telling anyone a ticket is queued behind a per-role cap.
- Tests: two roles in one project, project cap 3, role defaults 2 — a third worker of the first role still spawns. Existing tests that encoded the role cap are rewritten to the project cap.

`defaults.maxConcurrentRuns` (dispatcher default 6) is a host-wide *turn* cap, not a spawn cap: it does not refuse `workers.spawn`, so it is not the class of hidden cap that queued VS-154. Called out in `design.md`; changing it is out of scope.

## Capabilities

### New Capabilities

- `worker-concurrency/project-cap`: the project's Settings max-workers value is the only concurrency limit that stops a new worker spawning; a role/hire has no private cap.

### Modified Capabilities

(none — no existing capability specifies the spawn cap.)

## Impact

- `packages/core/src/workers/index.ts` — drop the `freeSlots` spawn gate; keep the `liveInProject >= project.maxWorkers` gate.
- `packages/core/src/roles/index.ts` — `concurrency` / `freeSlots` become project-pooled.
- `packages/ui/src/routes/Team.tsx` — remove `MaxWorkersField` and the per-role cap readout.
- Hire skill, conductor routing, `docs/PLAN.md`, `docs/OPERATIONS.md`, README — stop describing a per-role spawn cap.
- Tests in `workers.test.ts`, `roles.test.ts`, `team.test.tsx`, and any CLI/tool tests that asserted the role cap.
- No schema/migration: `roles.max_workers` stays as a stored field. Dispatcher `projectRunning` check stays (it already keys off the project).
