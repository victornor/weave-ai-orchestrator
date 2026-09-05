## 1. Schema and shared types

- [x] 1.1 Add migration `packages/db/src/migrations/0011_activity_project.sql`: a nullable `project_id` on `activity`, a backfill of existing rows from `tickets.project_id` via `ticket_id`, from `roles.project_id` for `role.hire`, and from `entity_id` for project actions, plus the indexes `activity_changelog(workspace_id, created_at DESC, id DESC)` and `activity_changelog_project(workspace_id, project_id, created_at DESC, id DESC)`. Verify with a test that migrates a db holding pre-existing ticket, role and project activity rows and asserts each row's `project_id` after migration, including the NULL case for a row that refers to nothing with a project.
- [x] 1.2 Add the changelog kinds and their action mapping to `packages/shared` (`CHANGELOG_KINDS` in `enums.ts` and the `ChangelogEntry` / `ChangelogDay` wire types), following the enum conventions in that package. Verify the mapping covers exactly the seven kinds in `entry-recording` and that a typecheck of `packages/shared` passes.
- [x] 1.3 Extend `recordActivity` in `packages/core/src/events.ts` with an optional `projectId`, and pass it from the ticket, role and project services so new rows carry it directly. Verify with a test that a newly created ticket's activity row has the ticket's project id without relying on the backfill.

## 2. The entry renderer

- [x] 2.1 Add `changelog.ts` to `packages/render`: a pure `changelogEntry(row)` producing `{ at, kind, actor, projectId, ticketIdentifier, summary, link }` from an activity row, with every detail field treated as optional and a degraded summary when one is missing. Verify with golden tests covering one row of each of the seven kinds plus a row with an empty `details_json`.
- [x] 2.2 Add the timeline grouping helper to the same module: given entries and an IANA timezone, produce the day / week / month separator boundaries the view renders. Verify with tests covering a run of entries crossing a day, a week and a month boundary, and one entry falling either side of midnight in a non-UTC timezone.

## 3. The core service

- [x] 3.1 Declare `ChangelogService` as a real interface in `packages/core/src/api.ts` (not `Record<string, unknown>`) with `list` and `heatmap`, and add it to `CoreServices`. In the same task, supply it in `packages/core/src/testing/context.ts` and `packages/server/test/fakes.ts` so the harnesses that proxy unstubbed services into a throw keep working. Verify the existing core and server suites still pass.
- [x] 3.2 Implement `list({ projectId?, before?, limit })` in `packages/core/src/changelog/`: newest-first over the projected actions only, filtering `plan_approved` on `details.to = 'approved'` and `pr_opened` on `details.type = 'pull_request'`, cursor-paged by `(created_at, id)`. Verify with tests for the workspace scope, a project scope, an operational action being excluded, a stable second page, and a row inserted between two page requests being neither repeated nor causing a skip.
- [x] 3.3 Implement `heatmap({ projectId?, from, to, tz })`: bucket the range's rows by day in the named IANA timezone with `Intl.DateTimeFormat`, returning a dense series of `{ date, landed, total, byKind }` with zero-filled empty days. Verify with tests for a full year returning every day, an entry near midnight bucketed by the named timezone rather than UTC, landed counts per day, and a project-scoped range.
- [x] 3.4 Verify the never-injected guarantee with a test that seeds changelog-producing activity into a workspace and asserts that a worker's and the conductor's `bootstrapDigest` text is byte-identical to the same workspace with no such activity, that the worker brief contains no entry, that `knowledge.lint()` and `knowledge.search()` return nothing for it, and that no registered agent tool exposes it.

## 4. The daemon upgrade entry

- [x] 4.1 In `packages/server/src/upgrade.ts`'s `reconcile()`, write one `daemon.upgraded` activity row into each registered workspace when an upgrade is finished, carrying the from/to release and the requester as the actor, guarded by the upgrade id so a repeated reconciliation writes nothing. Verify with a test that reconciling the same completed upgrade twice leaves exactly one entry per workspace, and that the entry carries no project and no ticket.

## 5. HTTP surface

- [x] 5.1 Add `GET /changelog` and `GET /changelog/heatmap` to `packages/server`, read-only, with the query parameters from design D8. Verify with route tests for both, for a project filter, for paging through `nextCursor`, and that no write method is routed on either path.
- [x] 5.2 Update `docs/API.md` with both routes and their response shapes, in the style of the surrounding entries. Verify by reading the rendered section against the implemented handlers.

## 6. Web app

- [x] 6.1 Add the `useChangelog` and `useChangelogHeatmap` query hooks to `packages/ui/src/api/hooks`, and add the new exports to every route test that mocks `../api/hooks` wholesale. Verify the ui suite passes on its own, not only through the root `pnpm test`.
- [x] 6.2 Add an activity heatmap component beside `packages/ui/src/components/Chart.tsx`: pure SVG, one cell per day for at least the last year, calendar-aligned, shaded from the design tokens, with a legend, a visible statement of the measure and its definition, hover and tap detail per day, and an activation callback. Verify with component tests for the cell count over a year, an empty day rendering in the empty shade, the detail appearing on hover and on tap, and the callback firing on activation.
- [x] 6.3 Add the Changelog tab to `KnowledgeRoute`: the heatmap above a newest-first timeline with day, week and month separators grouped in the reader's timezone, entries linking to their ticket or pull request, an empty state, and older pages loaded on demand with a loading state and an end-of-record state. Verify with route tests for the separators across a week and month boundary, a ticket link, a pull request link, the empty state, appending an older page, and the end-of-record state.
- [x] 6.4 Wire the heatmap to the timeline: activating a day scrolls to that day's separator, loading the intervening pages first when that day is older than everything loaded. Verify with tests for both the already-loaded and the not-yet-loaded day.

## 7. CLI

- [x] 7.1 Add `conductor changelog [--project <id>] [--from <date>] [--to <date>] [--json]` in `packages/cli/src/commands/`, following `conductor usage`'s option style: newest first, the shared renderer's summary, a default recent range that the output names, the machine's timezone for range interpretation, and `--json` emitting the entry fields. Verify with tests for the workspace scope, a project scope, both range ends, a start-only range, the default range being stated, an inverted range failing, an unknown project failing with its name, and the `--json` shape.

## 8. Documentation and gates

- [x] 8.1 Add `docs/PLAN.md` §13.6 recording the changelog, its entry kinds, its scopes, that it is not a knowledge file and is never injected, and the identifiers the code uses — the plan is the naming contract, so every `code`-styled name there must match the shipped one.
- [x] 8.2 Run `pnpm lint`, `pnpm typecheck`, `pnpm test` and `pnpm --filter @agent-conductor/ui exec vitest run` and verify all four are green, running the ui suite separately because the root `pnpm test` chains it behind core.
