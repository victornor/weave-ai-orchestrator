## 1. Data model and configuration

- [x] 1.1 Add `packages/db/src/migrations/0005_merge_queue.sql`: nullable `merge_queued_at` and
  `merge_started_at` on `tickets`, plus `CREATE INDEX IF NOT EXISTS tickets_merge_queue ON
  tickets(project_id, merge_queued_at)`. Verify by opening a temp workspace db through `openDb()` in a
  test and asserting `PRAGMA table_info(tickets)` lists both columns and that migrating twice is a
  no-op.
- [x] 1.2 Add `mergeQueuedAt: string | null` and `mergeStartedAt: string | null` to the `Ticket`
  interface in `packages/shared/src/types.ts`. Verify `pnpm typecheck` is green and no mapping code was
  needed (`ticketRow` passes columns through).
- [x] 1.3 Add `mergeConcurrency: z.number().int().min(1).max(8).default(1)` to `ProjectPoliciesSchema`
  in `packages/shared/src/config.ts`. Verify with a schema test that an empty policies object yields no
  value and that reading the effective limit falls back to 1, and that `0` and `9` are rejected.

## 2. The merge queue in core

- [x] 2.1 Add `packages/core/src/tickets/merge-queue.ts` exporting a queue service over the workspace
  db: `limitFor(projectId)` (project policy, default 1), `positionOf(ticketId)`, `forProject(projectId)`
  returning `{ concurrency, active, waiting }` with waiting entries numbered from 1 in
  `merge_queued_at` then `number` order, and `pump(projectId)` admitting waiting tickets while active
  count is below the limit. Verify with unit tests that ordering is by join time with `number` breaking
  ties, that positions start at 1, and that an empty project returns an empty queue carrying its limit.
- [x] 2.2 Make `pump` stamp `merge_started_at`, ensure a worker for the admitted ticket
  (`workers.spawnForTicket` when it has none), and enqueue the `merge_approved` wake that
  `tickets/service.ts` fires today. Verify with a test that admission emits exactly one
  `merge_approved` wake naming the ticket and that pumping an already-full project emits none.
- [x] 2.3 Change `transition()` in `packages/core/src/tickets/service.ts`: on entry to `merging`, stamp
  `merge_queued_at` when unset and call `pump(projectId)` instead of waking the worker directly; a
  ticket with no `projectId` is admitted immediately. Verify with tests that a merge approval on a
  project already at its limit leaves the ticket waiting with no wake, and that the first approved
  ticket in an idle project is admitted and woken.
- [x] 2.4 Clear `merge_queued_at` and `merge_started_at` and pump the project whenever a ticket leaves
  `merging` — through `transition()` (to `blocked`, `in_review`) and in `mergeDone` when the ticket
  becomes `done`. Verify with tests that a merged ticket and a failed (blocked) ticket both release the
  slot and that the next waiting ticket is admitted and woken in each case.
- [x] 2.5 Expose the queue on `CoreServices` (`packages/core/src/api.ts`) as `tickets.mergeQueue` or a
  sibling service, following the existing service-wiring style. Verify `pnpm lint` (boundary guard) and
  `pnpm typecheck` stay green.

## 3. Supervision, liveness and spawning

- [x] 3.1 Add a `pumpMergeQueues()` sweep to the supervisor tick
  (`packages/core/src/supervisor/index.ts`) that pumps every project holding a merging ticket. Verify
  with a test that a project with a free slot and a waiting ticket admits it on a tick with no
  transition having occurred.
- [x] 3.2 Exclude waiting tickets (`status='merging' AND merge_started_at IS NULL`) from
  `livenessViolations()` in `packages/core/src/tickets/service.ts`. Verify with a test that a waiting
  ticket with no live run and no queued wake is not reported, while an admitted merging ticket in the
  same state still is.
- [x] 3.3 Skip waiting tickets in `spawnPending()` in `packages/core/src/supervisor/index.ts`. Verify
  with a test that no worker is spawned for a waiting ticket and that one is spawned once it is
  admitted.
- [x] 3.4 Extend the merge turn's prompt in `packages/core/src/prompts/index.ts` so an admitted worker
  is told it holds the project's merge slot and must re-sync with the current default branch before
  landing. Verify with a prompt/render test asserting the merge-phase text mentions the queue slot and
  the re-sync.

## 4. Landing verification and serialisation

- [x] 4.1 Rewrite the `pr` verification in `packages/core/src/tickets/land.ts` as the four ordered
  checks from design D6 (ancestry, tree equality, squash patch-id against commits gained since the
  merge base, then `git cherry`), with `LandResult.detail` naming the check that passed, and switch its
  private `git` helper to `packages/core/src/util/git.ts`. Verify with tests over real temp
  repositories: a multi-commit branch squash-merged verifies; the same with unrelated commits landed
  afterwards verifies; a merge commit verifies; a branch whose changes are absent raises
  `merge_unverified`.
- [x] 4.2 Move the per-project promise-chain serialiser out of `packages/core/src/openspec/index.ts`
  into `packages/core/src/util/serialize.ts`, use it from both that call site and around the
  `landDelivery` call in `mergeDone`. Verify with a test that two landings of one project do not
  overlap while landings of two projects do, and that the existing openspec tests still pass.

## 5. Reporting the queue

- [x] 5.1 Add `GET /projects/:id/merge-queue` in `packages/server/src/routes/projects.ts` returning the
  read model, and add `mergeQueue` (the ticket's position and the project's limit) to the
  `GET /tickets/:id` payload. Verify with server route tests for a populated queue, an empty queue, and
  a waiting ticket's own position.
- [x] 5.2 Document the new route and the extended ticket payload in `docs/API.md`. Verify the entry
  matches the handler's actual response shape.
- [x] 5.3 Add `conductor ticket merge-queue [--project <id>]` in
  `packages/cli/src/commands/ticket.ts`, printing active and waiting tickets with positions and
  honouring the existing JSON output flag. Verify with a CLI test against a stubbed client for both the
  table and JSON forms.
- [x] 5.4 Add the `useMergeQueue` hook (`packages/ui/src/api/hooks.ts`, key in `keys.ts`, type in
  `types.ts`), a merge-queue panel on `packages/ui/src/routes/Board.tsx`, and a queue-position badge on
  `packages/ui/src/routes/TicketPage.tsx` fed from the ticket detail payload. Add the new hook export to
  every route test that mocks `../api/hooks` wholesale. Verify `pnpm vitest run packages/ui` is green
  and a component test renders position and active/waiting states.

## 6. Documentation and full verification

- [x] 6.1 Update `docs/PLAN.md` §11.4 and §12.2 step 6 so the merge flow reads "approval → merge queue
  → admitted → merge", and add `docs/adr/0006-merge-queue.md` recording the deliberate departure from
  §11.5's "serialize only on declared blockers". Verify both documents name `mergeConcurrency` and the
  two ticket fields exactly as implemented.
- [x] 6.2 Update the `agent-conductor-worker` skill's delivery reference
  (`skills/agent-conductor-worker/references/delivery.md`) so the merge procedure states that the wake
  means the ticket now holds the merge slot and the base must be re-synced. Verify the wording matches
  the prompt text from task 3.4.
- [x] 6.3 Run `pnpm lint && pnpm typecheck && pnpm test` and confirm all three are green, including the
  new queue-ordering, concurrency-limit, failure-does-not-block, squash-verification and
  serialisation tests.
