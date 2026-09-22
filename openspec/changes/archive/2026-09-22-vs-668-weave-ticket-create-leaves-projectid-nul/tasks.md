## 1. Derive the project from the role at create

- [x] 1.1 In `tickets.create()` (`packages/core/src/tickets/service.ts`), when an `assigneeRoleId` is given and `projectId` is absent, store the role's project; refuse with a validation error if the role's project is empty rather than storing null. Verify with a test that fails on current code: `packages/core/src/tickets/tickets.test.ts` — create with `projectId: null` and a project-scoped role yields a `projectId` equal to the role's project.
- [x] 1.2 Cover the explicit-project cases in the same test file: a matching explicit project is stored, a conflicting one is refused with no ticket written, and a create with no role still stores a null project.

## 2. Derive the project from the role at assign (correction path)

- [x] 2.1 In `tickets.assign()` (`packages/core/src/tickets/service.ts`), when a role is assigned to a ticket whose project is null, set the ticket's project to the role's project; keep the existing refusal when a set project differs from the role's. Verify with a test: assigning a role to a project-less ticket fills `projectId`, and a cross-project assignment is refused with the project unchanged.

## 3. Backfill tickets already affected

- [x] 3.1 Add `packages/db/src/migrations/0062_ticket_role_project_backfill.sql` setting `project_id` to the assignee role's project for every ticket with a null project and a resolvable role. Verify with a migration test in `packages/db/src/migrations.test.ts`: build a database through `0061_session_retired_reason.sql`, seed a null-project ticket with a role, reopen with `openDb`, and assert the project is filled.
- [x] 3.2 Verify the backfill touches only the intended rows: a ticket with no role and a ticket that already has a project are unchanged, and reopening the migrated database applies nothing further.

## 4. Acceptance and tool prose

- [x] 4.1 Add a core test (`packages/core/src/tickets/tickets.test.ts`) that creates a ticket with a project-scoped role and no project, then calls `tickets.openPullRequest` against a fake github forge, and asserts it returns a pull request instead of the "has no project to open a pull request against" error.
- [x] 4.2 Update the `weave_ticket_create` description in `packages/server/src/tools.ts` to state the project comes from the assignee role when none is given, and run `packages/shared/src/tools.test.ts` to confirm the agent-facing prose guard still passes.

## 5. Checks

- [x] 5.1 Run `pnpm lint && pnpm typecheck` and the changed test files; then run the full `pnpm test` once and paste both suite blocks verbatim in the PR.
