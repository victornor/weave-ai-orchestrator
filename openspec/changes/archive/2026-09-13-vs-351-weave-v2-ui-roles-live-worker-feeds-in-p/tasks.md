## 1. The V2 Roles screen

- [x] 1.1 Build `packages/ui/src/v2/RolesPage.tsx` exporting `V2RolesPage`, and re-export it from
  `v2/pages.tsx` (replacing the placeholder `V2RolesPage` defined there) exactly as `V2NeedsPage`
  is. Verify the route `/v2/w/:ws/roles` renders the screen inside `V2Page` with the `Roles` title.
- [x] 1.2 Add the pure helper `groupRolesByProject(projects, roles)` returning the projects in order,
  each with its roles, and `liveWorkersOf(workers, roleId)` returning only the live statuses
  (`provisioning`, `active`, `running`, `paused`, `error`). Verify with unit tests that a role lands
  under its own project and never under another, and that retired and landed-`done` workers are
  excluded.
- [x] 1.3 Render each project group and role card: the role name, `roleStateLabel(status)` (with
  `pending_activation` reading **awaiting hire approval**), the live count against `maxWorkers`, and
  the charter summary. Verify with a test that grouped roles render under their projects and that a
  `pending_activation` role reads "awaiting hire approval".
- [x] 1.4 Show the "No role hired for this project yet." state for a project with no roles, and an
  error state when the roles query fails. Verify with tests for the empty group and the error.

## 2. The working worker's feed in place

- [x] 2.1 Add the worker row: a live worker's row is a toggle; a non-live worker's row navigates to
  `/v2/w/$ws/workers/$workerId`. Verify with a test that activating a non-live worker opens the
  worker page and no feed appears.
- [x] 2.2 Expand the VS-345 `WorkerFeed` (compact) in place for a live worker, headed by the run's
  `model` and the worker's ticket title and footed by its spend and an **Open in Live** link to
  `/v2/live`. Verify with a test that expanding a live worker renders the feed, the model, the ticket
  title, the spend and the Live link.
- [x] 2.3 Hold expansion state per worker (a `Set` keyed by worker id) so expanding one worker does
  not expand another. Verify with a test that expanding one of two live workers leaves the other
  collapsed and that a second activation collapses the first.
- [x] 2.4 Resolve a worker's live-ness and run metadata through VS-345's `useWorkerRun`, with no new
  run-stream hook and no edit to `v2/WorkerFeed.tsx`. Verify by inspection and by the tests above.

## 3. The Hire a role modal

- [x] 3.1 Add the pure `buildHireRequest(slug, description)` returning
  `` `/hire-role project=${slug}\n\n${description}` ``. Verify with a unit test asserting the exact
  string for a slug and description.
- [x] 3.2 Build the modal: a project picker from `useProjects`, a free-text description field, a live
  preview rendered from `buildHireRequest`, and a footer stating the charter comes back for approval.
  Verify with a test that picking a project and typing a description renders the preview from the
  helper and the footer copy.
- [x] 3.3 Send: resolve the default thread with the chat route's own rule (`defaultThread` in
  `lib/threads.ts`, shared with V1's chat, not a second weaver-thread rule; creating a thread with
  `useCreateThread` only when none exists) and post `buildHireRequest(...)` through
  `usePostThreadMessage`; disable send until a project is picked and the description is non-empty.
  Verify with a test that the body sent equals the preview and goes to the default thread the chat
  would open when two exist, and that send is unavailable while the project or description is
  missing.

## 4. The kept management actions

- [x] 4.1 Overflow menu per role with Pause / Resume / Retire through `useRoleAction`, reflecting the
  role's status. Verify with a test that each action calls the mutation with the role's id and that a
  paused role offers Resume, an active one Pause.
- [x] 4.2 Charter drawer: render the charter and its revisions from `useRole`, an edit field that
  saves through `usePutCharter` with a required reason, and a rollback per revision through
  `useRollbackCharter`. Verify with tests that saving sends the edited charter with its reason and
  that rolling back calls the rollback mutation for that revision.
- [x] 4.3 Max workers: a number input that calls `useUpdateRole` with `{ patch: { maxWorkers },
  reason }`. Verify with a test that changing it PATCHes the role with the new `maxWorkers`.
- [x] 4.4 Start session: a title (and optional description) calling `useStartSession` for the role's
  project and role, then opening the new worker's page. Verify with a test that Start calls the
  start-session mutation with the project and role and navigates to the returned worker.
- [x] 4.5 Render a failed role update or action as an error state rather than swallowing it. Verify
  with a test that a rejected mutation shows the error.

## 5. The weaver hire-request rule

- [x] 5.1 Add the format rule to `skills/weave-ai-hire/SKILL.md`: a message whose first line is
  `/hire-role project=<slug>` is a hire request for that project, handled through the normal overlap
  check, drafting and `weave_role_hire` flow, so the charter still returns for approval.
- [x] 5.2 Add one sentence to the hiring bullet in `templates/weaver.AGENTS.md.tmpl` naming the
  `/hire-role project=<slug>` format. Confirm no `weave_*` token is introduced that
  `packages/shared/src/tools.test.ts` would reject, and that no `ac_*` identifier is touched.

## 6. Verification

- [x] 6.1 Run `pnpm lint` and `pnpm typecheck`; both clean.
- [x] 6.2 Run `pnpm test` (core/server suite) and `pnpm --filter @weave-ai/ui exec vitest run`
  separately; paste both suite blocks verbatim in the report and confirm both pass.
- [x] 6.3 Confirm no HTTP route, MCP tool, CLI command, database migration or daemon file changed,
  and that V1 at `/` and its tests are untouched.
- [x] 6.4 Run `openspec validate vs-351-weave-v2-ui-roles-live-worker-feeds-in-p --json --strict` and
  confirm it is clean.
- [x] 6.5 Treat the acceptance list as the exit criteria: real roles grouped per project; a working
  worker's feed expands in place; the hire preview equals the sent message and lands in the weaver
  chat; pause/resume/retire, charter revisions and rollback, and max workers work; the hire skill
  contains the format rule.
