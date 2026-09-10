# Allow changing a hired role's max workers

Tracker change for [VS-30](conductor://tickets/VS-30). A `task` ticket, so this change carries
tasks only — `skip_specs: true`.

## Why

`maxWorkers` is fixed at hire time in practice. `PATCH /w/:ws/roles/:id` already accepts it as part
of a `RoleSpec` patch and records a revision, but nothing reaches that path: the web app's role
sheet edits only runtime and model, the CLI has `role set-runtime` / `role set-model` and nothing
else, and the conductor's role tools stop at `ac_role_update_charter`. Raising the cap meant
re-hiring the role.

## What changes

- `RolesService.concurrency(id)` — role limit, project limit, the effective (smaller) limit, live
  workers and free slots, in one place.
- `GET /w/:ws/roles/:id` returns that block; `ac_role_get` returns it too.
- `ac_role_set_max_workers` for the conductor.
- `conductor role set-max-workers <id> <n>` for the CLI.
- A stepper on the web app's role sheet, showing the effective concurrency next to it.

Enforcement is unchanged: `workers.spawn` reads `roles.freeSlots` and the project limit from the
database on every spawn, so a new limit applies from the supervisor's next sweep and a lowered one
only stops new spawns.

## Out of scope

Charter, scope and permission editing (already exists) and the project-level `maxWorkers` (already
editable in Settings).
