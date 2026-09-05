## 1. The record

- [x] 1.1 Add `JOB_KINDS` (`project_add`), `JOB_STATES` (`running|done|failed`), `JOB_STEP_STATES` (`pending|running|done|skipped|failed`) and `PROJECT_ADD_STEPS` (`clone`, `resolve_branch`, `declare`, `openspec`, `knowledge`, `ticket`, each with its label) to `packages/shared/src/enums.ts`, and the `Job`, `JobStep`, `JobLogLine` types to `packages/shared/src/types.ts`; verify `pnpm typecheck` passes and nothing branches on a raw string.
- [x] 1.2 Add `job.started` and `job.finished` to `EVENT_TYPES` in `packages/shared/src/events.ts`; verify `pnpm typecheck` passes.
- [x] 1.3 Write `packages/db/src/migrations/0009_jobs.sql` creating the workspace-scoped `jobs` table (id, workspace_id, kind, entity_type, entity_id, state, steps_json, log_json, log_seq, requested_by, started_at, finished_at, failed_step, message) with an index on `(workspace_id, entity_id, started_at DESC)`; verify `pnpm vitest run packages/db` passes and the migration test sees the new table.

## 2. The jobs service

- [x] 2.1 Add `packages/core/src/jobs/index.ts` — `createJobsService(ctx)` with `start(kind, entity, requestedBy)`, `step(jobId, stepId, state)`, `line(jobId, stepId, stream, text)`, `finish(jobId, state, {failedStep, message})`, `get`, `list({kind, entityId})`, `onItem(handler)`, seeding the full `pending` step list per kind, keeping the last `JOB_LOG_LINES = 200` lines, flushing the row at most every `JOB_LOG_FLUSH_MS = 250` and always on a step transition or finish, and emitting `job.started`/`job.finished` on the outbox and nothing per line; verify with a new `packages/core/src/jobs/jobs.test.ts` covering the step lifecycle, the bounded tail, and that a line produces no outbox event.
- [x] 2.2 Wire the service into `CoreServices`/`WorkspaceContext` (`packages/core/src/api.ts`, `create.ts`) with a real `JobsService` interface — not `Record<string, unknown>` — so the wire shape typechecks; verify `pnpm typecheck` passes.
- [x] 2.3 Settle jobs left `running` by a previous process at workspace load: `jobs.reconcile()` fails them with a message naming the restart; verify a test that inserts a `running` job, loads the workspace and asserts the job is `failed`.

## 3. Streaming a child's output

- [x] 3.1 Add `onLine?: (stream: 'stdout' | 'stderr', line: string) => void` to `sh` in `packages/core/src/util/exec.ts`, consuming execa's streams line by line (splitting on `\n` and `\r`) while still resolving with the same `ExecResult`, and forward it from `git()` in `packages/core/src/util/git.ts`; verify a test that runs a command printing several lines and asserts both the callback order and the unchanged buffered result.

## 4. Project add reports as it goes

- [x] 4.1 Split the body of `projects.add` into an internal `runAdd(project, cfg, job)` that opens and closes each of the six sub-steps, marks the OpenSpec sub-step `skipped` when it is disabled or already present, and passes `onLine` to `git clone`, `openspec init` and `git push`; verify `pnpm vitest run packages/core/src/projects` still passes and a new test asserts the six sub-steps and their end states for a successful add.
- [x] 4.2 Keep `projects.add(actor, cfg)` awaiting the full pipeline (used by `reconcile()` and the tests) and add `startAdd(actor, cfg): { project, jobId }` which creates the row and job, starts `runAdd` unawaited with a terminal handler, and returns; verify a test that `startAdd` returns a `cloning` project before the job finishes and that the project becomes `ready` once it does.
- [x] 4.3 Add `retryAdd(actor, projectId): { project, jobId }` — `conflict` unless the project is `error`, `conflict` while a job for it is running, and reusing the existing clone; verify tests for the happy retry (clone sub-step completes without re-cloning), the refusal on a `ready` project and the refusal on a concurrent job.
- [x] 4.4 Assert on the failure path that a failed sub-step fails the job with `failedStep` set and leaves the project `error` with its error text, and that the later sub-steps stay `pending`; verify with a test that makes the clone fail.

## 5. The API

- [x] 5.1 Change `POST /api/w/:ws/projects` to call `startAdd` and answer `202 { project, jobId }`; verify a server test asserts the status, the `cloning` project and the job id.
- [x] 5.2 Add `POST /api/w/:ws/projects/:id/retry` → `202 { project, jobId }`, and `GET /api/w/:ws/jobs?kind=&entity=` and `GET /api/w/:ws/jobs/:id`; verify server tests for each, including the `conflict` on a `ready` project.
- [x] 5.3 Add `GET /api/w/:ws/jobs/:id/stream` — replay the record then tail via `Pump`, frames `job.step`/`job.log`/`job.finished` with `id: <seq>`, resumable with `?after=` and `Last-Event-ID`, copying `routes/runs.ts`; verify a test that attaches mid-job, receives the replay and then live items, and that `?after=` returns only later items.
- [x] 5.4 Update `docs/API.md` with the new `202` contract, the retry route and the three job routes, and note the BREAKING change; verify the routes listed there match the router.

## 6. The CLI

- [x] 6.1 Make `conductor project add` post, then follow `/jobs/:id/stream` via `client.stream`, printing each sub-step as it starts and its output lines, ending in the existing summary; on failure name the failing sub-step, print its last lines, name `conductor project retry <id>`, and exit non-zero; verify a CLI test against a stubbed stream asserts the printed sub-steps and the non-zero exit.
- [x] 6.2 Keep `--json` printing exactly one final project document with no progress interleaved, and add `conductor project retry <id>`; verify a CLI test asserts the single JSON document, and add both to the README cheat-sheet and PLAN §20.

## 7. Onboarding

- [x] 7.1 Add a `JobProgress` component to `packages/ui` rendering a job's sub-steps, the active one, per-step elapsed time and a bounded `<pre>` tail, taking the job as a prop (DecisionCard-style, not via mocked hooks); verify a component test that feeds it a running job and a failed job and asserts the active sub-step, the elapsed time and the last lines.
- [x] 7.2 Add a `useJobStream(jobId)` hook mirroring `runStream.ts` (replay-then-tail `EventSource`, `?after=`, backoff); verify a test that a frame updates the returned job.
- [x] 7.3 Rework the onboarding create step to keep per-step elapsed time for every step, attach `JobProgress` to the project steps, and show a Retry button on a failed step that calls the retry route and re-attaches; verify a route test that a failed project step renders the failing sub-step, its lines and the retry control.
- [x] 7.4 Persist `ac.onboarding.resume` (`{ workspaceId, steps: [{ label, kind, jobId? }] }`) as the create step advances, restore it on mount when the workspace still exists, clear it on leaving, and fall back to `GET /jobs?entity=<projectId>` when a job id is missing; verify a test that a reload mid-step restores the create view attached to the running job, and one that a finished flow restores the outcome.

## 8. Green

- [x] 8.1 Run `pnpm lint && pnpm typecheck && pnpm test` and fix what they report; verify all three are green.
