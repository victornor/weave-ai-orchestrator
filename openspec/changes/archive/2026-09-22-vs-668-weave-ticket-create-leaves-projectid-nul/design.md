## Context

- `tickets.project_id` is nullable (`0001_init.sql`); `roles.project_id` is `NOT NULL`. There is no
  such thing as a workspace-scoped role today, so a ticket created for a role always has a project it
  should belong to.
- `weave_ticket_create` (`packages/server/src/tools.ts`) calls
  `tickets.create(actor, { ...input, projectId: isConductor(ctx) ? (input.projectId ?? null) : ctx.claims.projectId })`.
  A worker's project is forced from its claims, but the weaver's is `input.projectId ?? null`, so a
  weaver call that names only `assigneeRoleId` stores NULL.
- The worker still spawns into the role's project — `workers/index.ts` resolves
  `projectOf(role.projectId)` — so nothing fails until a reader resolves the *ticket's* project.
- `tickets.create()` already loads the role when `assigneeRoleId` is set, to check existence,
  retirement and an explicit-project mismatch. The derivation belongs beside that check.

## Goals / Non-Goals

**Goals:**

- A ticket with an assignee role has that role's project: at create, and on assign.
- Tickets already left project-less (VS-665, VS-667) are corrected without a manual `gh` workaround
  or a hand edit of the workspace database.
- No caller is forced to pass a new argument; a ticket filed with no role behaves exactly as today.

**Non-Goals:**

- Not requiring `projectId` on every ticket. Filing a project-less ticket with no role stays allowed
  (that is how the weaver files workspace-level work).
- Not changing how a worker's own project is chosen — the role already decides it.
- Not adding a general-purpose ticket-edit tool or a new admin correction endpoint.

## Decisions

### D1 — Derive in the core `tickets.create()` service, not in the MCP tool handler

The handler is one of several callers of `tickets.create` (the HTTP `POST /tickets` route, the
session path and the routine path all reach it). Deriving in the service fixes every caller and keeps
the new rule next to the existing role/project validation, so a future caller cannot reintroduce the
null. Alternative rejected: patch the `weave_ticket_create` handler only — it repairs one entrance
and leaves `POST /tickets` able to write the same broken row.

### D2 — Derive in `tickets.assign()` too, as the correction path

`create()`-time cannot reach a ticket that already exists, and no agent-facing tool can set a
ticket's `projectId` today (`weave_ticket_assign` and `weave_ticket_set_priority` are the only
writers, and `set_priority` never touches it). Assignment is the natural place: a role assignment
already implies the project, and `assign` already refuses a role from a different project. So when a
role is assigned to a project-less ticket, the ticket adopts the role's project. Alternative
rejected: a new admin-only tool — a larger surface for the same outcome, and the ticket explicitly
allows extending an existing patch-style path where reassignment implies a project.

### D3 — Backfill with a one-time migration, not a manual step

The affected rows live in the running workspace's SQLite database. A data migration
(`0062_ticket_role_project_backfill.sql`) backfills every ticket with a null project whose role has a
project, and runs at the next `weave daemon upgrade` — so VS-665 and VS-667 need no manual
correction, and the `weave_ticket_open_pull_request` refusal disappears for them. The statement
touches only rows matching that shape, so it is safe and idempotent on a database with none.
Alternative rejected: leave the two tickets to a human or the weaver to fix by hand; there is no
agent tool to do it, and a manual DB edit on the live install is exactly what worker rules forbid.

### D4 — No "ambiguous role" branch: roles are always project-scoped

The ticket's requirement mentions keeping current behaviour when a role is not project-scoped.
`roles.project_id` is `NOT NULL`, so that state cannot occur and there is nothing to disambiguate. A
role that cannot be found is already a `not_found` error. The design keeps a defensive check that
refuses with a validation error if a role's project is somehow empty, rather than storing NULL, so
the contract holds if a workspace-scoped role is ever introduced.

## Audit — other readers of a ticket's `projectId` (ticket requirement 4)

| Reader | Behaviour with a null-project ticket | After this change |
|---|---|---|
| `tickets.openPullRequest` (`weave_ticket_open_pull_request`) | Refuses: "has no project to open a pull request against" — the reported break | Fixed: project is present |
| `roadmap` `requireTicket` (`weave_roadmap_item_update`/`_add` linking) | Rejects the ticket as "not in this project", so a roadmap item can never link it | Fixed: project is present |
| `tickets.list({ projectId })` (`weave_ticket_list`, HTTP `?project=`) | `WHERE project_id = ?` excludes it — invisible to every project filter | Fixed: project is present |
| Merge queue (`limitFor`, `waitingOf`/`activeOf`) | `limitFor(null)` returns 1 and the per-project queries exclude it, so a merging ticket is not in its project's queue | Fixed: project is present |
| Worker knowledge and knowledge-usage scoping | **Not** affected — scoped by the run's claims project (from the role) and linked by run/ticket id, never by the ticket's own project | Unchanged |
| Supervisor merge board and project-scoped UI views | Group/serve by `tickets.project_id`; a null-project row falls out of its project | Fixed: project is present |

The operator `PATCH /tickets/:id` route can still write an explicit `projectId` (including null). That
is a human operator escape hatch, outside the agent-facing invariant this change establishes; it is
noted here rather than changed.

## Risks / Trade-offs

- A caller that names a role but genuinely wants a project-less ticket can no longer express that. →
  Intended: a role implies a project. A project-less ticket is filed with no role.
- The migration rewrites rows in the live database. → Scoped to `project_id IS NULL` with a resolvable
  `assignee_role_id`; idempotent (`WHERE project_id IS NULL`), and tested against a database built
  through `0061`.
- `update()` can still null a `projectId` through the operator route. → Out of scope; the invariant is
  enforced on the agent create/assign paths, and the audit records the residual.

## Migration Plan

1. Land the code change (create/assign derivation) and the `0062` backfill together.
2. On `weave daemon upgrade`, boot migration applies `0062`; existing null-project tickets with a role
   are corrected before the daemon serves.
3. No rollback script: the change is forward-only and re-nulling a project would reintroduce the bug.
   A rollback of the release leaves the backfilled data valid.

## Open Questions

None that affect the specs, the approach or the task breakdown. Whether the operator `PATCH` route
should refuse to null a `projectId` for a role-assigned ticket is a deferrable follow-up with no
requirement impact.
