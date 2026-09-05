## 1. Storage and DTO

- [x] 1.1 Add migration `packages/db/src/migrations/0004_thread_message_project.sql` adding a nullable `project_id TEXT REFERENCES projects(id)` to `thread_messages` (no backfill, no index, no `ON DELETE`), and add `projectId: string | null` to `ThreadMessage` in `packages/shared/src/types.ts`; verify by running `pnpm vitest run packages/core packages/db` and confirming the suite still migrates a fresh database green. (`0003` was taken by VS-11, which landed on `main` while this plan was in review, so the migration is `0004`.)

## 2. Carrying the reference through the service

- [x] 2.1 Extend `ThreadsService.inbound`'s options in `packages/core/src/api.ts` with `projectId?: string | null` and thread it through `insertMessage` in `packages/core/src/threads/service.ts` so the column is written; verify with a core threads test that sends an inbound message with `h.projectId` and asserts `threads.messages(...)` returns it with that `projectId`, plus one asserting a message sent without it has `projectId: null`.
- [x] 2.2 Resolve the reference through `deps().projects.get(...)` inside `inbound`'s transaction **before** the insert, letting the `not_found` `OcError` propagate; verify with a core threads test asserting that an unknown project id rejects, stores no message on the thread, and enqueues no wake.
- [x] 2.3 Add `projectId` and `projectSlug` (both `null` when no project was chosen) to the `human_message` wake payload, and name the project in the wake's `reason` when there is one; verify with core threads tests asserting the payload fields for a message with a project and for one without, and that the ticket-bound branch is unchanged.

## 3. HTTP surface

- [x] 3.1 Accept an optional `projectId` on `POST /api/w/:ws/threads/:id/messages` in `packages/server/src/routes/threads.ts` and pass it to `inbound`; verify with a server test posting a message with a valid project (201, the reference on the stored message) and one with an unknown project (error status, nothing stored).
- [x] 3.2 Update the `POST /threads/:id/messages` line in `docs/API.md` to document the new optional field.

## 4. Web conductor chat

- [x] 4.1 Add `projectId` to `ThreadMessage` in `packages/ui/src/api/types.ts` (or its re-export) and to `usePostThreadMessage`'s input in `packages/ui/src/api/hooks.ts` so the field reaches the request body; verify with `pnpm typecheck` and by asserting the posted body in a UI test.
- [x] 4.2 Render a compact project `<select>` in `ChatRoute` through `Composer`'s existing `scope` slot, listing non-archived projects plus an "all projects" option meaning no project, and initialise it from the `projectId` of the thread's most recent inbound message; verify with UI tests covering the default from a thread whose last message named a project, a thread whose last message named none, an empty thread, and a workspace with no projects.
- [x] 4.3 Send the current selection with the message on both paths — `post.mutate` when online and the `enqueue` body when offline — and keep the selection after sending; verify with UI tests asserting the posted body and the queued body each carry the chosen `projectId`, and that "all projects" sends no reference.
- [x] 4.4 Show the project a sent message carried as a chip on that message in `ChatMessage`, resolving the name from `useProjects()` and falling back to the raw reference when the project is not in the list; verify with UI tests covering a message with a project, a message without one (no chip, unchanged rendering), and a message whose project is missing from the list.

## 5. Documentation of the deviation

- [x] 5.1 Write `docs/adr/0005-thread-message-project-reference.md` recording the `thread_messages` schema extension beyond PLAN §13's column list, with the reason and the alternatives from `design.md`; verify the file exists and follows the heading format of `docs/adr/0004-auto-merge-sweep.md`.
- [x] 5.2 Add the project selector to the `Composer` line in `docs/design/DESIGN-CONTRACT.md` so the visual contract matches what ships.

## 6. Verification

- [x] 6.1 Run `pnpm typecheck`, `pnpm lint` and `pnpm test` and confirm they pass, noting any pre-existing failures that also fail on `main` in a worker worktree.
  - All green with no pre-existing failures: `pnpm lint` ok, `pnpm typecheck` ok, `pnpm test` 633 passed / 1 skipped plus the web app's 74. The web app is not in the root `tsconfig.json` project references, so `pnpm --filter @agent-conductor/ui typecheck` was run separately and is also clean.
