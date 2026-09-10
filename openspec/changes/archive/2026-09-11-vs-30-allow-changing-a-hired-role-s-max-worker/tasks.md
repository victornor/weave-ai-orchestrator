# Tasks

- [x] 1. Add `RolesService.concurrency(id)` returning `{ roleMax, projectMax, effective, live, projectLive, free }`; `freeSlots` keeps its role-only meaning for the spawn gate.
- [x] 2. Return the concurrency block from `GET /w/:ws/roles/:id` and from `ac_role_get`; document it in `docs/API.md`.
- [x] 3. Add the `ac_role_set_max_workers` conductor tool (name in `shared/src/tools.ts`, handler in `server/src/tools.ts`, revision via `roles.update`).
- [x] 4. Add `conductor role set-max-workers <id> <n> [--reason]` and show the effective limit in `role show`.
- [x] 5. Add a max-workers editor plus the effective-concurrency readout to the web app's role sheet.
- [x] 6. Tests: raising and lowering the limit, the effective-concurrency calculation, spawn behaviour under a lowered limit, the new tool and the new CLI command.
- [x] 7. Update the docs and skills that name the role tools and CLI commands (`docs/PLAN.md`, `README.md`, `skills/agent-conductor-conductor`).
