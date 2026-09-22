## Why

`weave_ticket_create` accepts an `assigneeRoleId` without a `projectId` and stores the ticket with
`project_id` NULL, even though every role belongs to exactly one project. The worker is still spawned
correctly (it derives the project from the role), so the mistake is invisible until something reads
the *ticket's* project: `weave_ticket_open_pull_request` refuses with "has no project to open a pull
request against", roadmap linking rejects the ticket as "not in this project", and every
project-filtered list or view silently omits it. The weaver filed VS-665 and VS-667 this way on
2026-09-22; VS-665's worker had to open its pull request by hand with `gh`.

## What Changes

- `tickets.create()` derives `projectId` from the assignee role when the caller supplies none. A role
  is always project-scoped (`roles.project_id` is `NOT NULL`), so a ticket created for a role is a
  ticket of that role's project.
- `tickets.assign()` derives the project the same way when a role is assigned to an already-created,
  project-less ticket. This makes assignment the live correction path the create-time fix cannot give
  to tickets that already exist.
- A schema migration backfills tickets that already have `project_id` NULL and a role whose project is
  known — this corrects VS-665 and VS-667 at upgrade, with no manual `gh` workaround or DB edit.
- The `weave_ticket_create` tool description states that the project comes from the role.
- Findings for the other readers of a ticket's `projectId` are recorded in `design.md`.

## Capabilities

### New Capabilities

- `ticket-lifecycle/project-scoping`: a ticket assigned to a role carries that role's project — at
  create, at assign, and for tickets already left project-less before the fix.

### Modified Capabilities

<!-- None: no existing requirement describes project derivation, so this is a new capability rather than a change to one. -->

## Impact

- `packages/core/src/tickets/service.ts` — `create()` and `assign()`.
- `packages/db/src/migrations/0062_ticket_role_project_backfill.sql` — one-time backfill.
- `packages/server/src/tools.ts` — `weave_ticket_create` description.
- Tests: `packages/core/src/tickets/tickets.test.ts`,
  `packages/db/src/migrations.test.ts`, `packages/server/test/`.
- No public HTTP shape changes: the create and assign request bodies are unchanged; they simply
  resolve `projectId` instead of storing NULL.
