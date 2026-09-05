## Context

See `proposal.md` — Why. The constraints that shape the approach:

- `projects.add` (`packages/core/src/projects/index.ts:100-146`) is one awaited function called from
  three places: the HTTP route (`packages/server/src/routes/projects.ts:17`), `reconcile()` (same
  file, on workspace load) and the tests. Only the HTTP path needs to become asynchronous.
- Child processes are run through `sh` (`packages/core/src/util/exec.ts:8`), which awaits execa and
  returns the whole buffered output. Nothing in `core` streams a child's output today.
- The workspace event bus (`packages/core/src/events.ts`) is a **durable outbox**: every `emit` is a
  row in `events`, replayed to every SSE client and fed to hooks and webhooks. It is the wrong place
  for per-line output.
- Two streaming precedents already exist and should be copied rather than reinvented: the
  replay-then-tail SSE loop with `id: <seq>` (`packages/server/src/routes/runs.ts:26-56`, consumed by
  `packages/ui/src/api/runStream.ts` and by the CLI's `client.stream`), and the bounded log tail on a
  durable record rendered as a `<pre>` (`upgrades.log_json`, `UPGRADE_LOG_LINES = 200`,
  `packages/ui/src/routes/Settings.tsx:798`).
- `packages/db` runs the same migration set against every workspace database and against
  `daemon.sqlite`; a workspace-scoped table carries `workspace_id` (`0001_init.sql`), a daemon-level
  one does not (`0007_upgrades.sql`).

## Goals / Non-Goals

**Goals:**

- One mechanism, reusable by the next long operation, without building a general job queue.
- The output of a running command is visible before the command exits.
- The record is enough to diagnose a failure after the fact, and small enough to keep forever.
- No change to what project add actually does, or to when the setup command runs.

**Non-Goals:**

- Scheduling, retries with backoff, priorities, concurrency limits, or cancellation of a job. A job is
  started by a request and runs once; retry is an explicit new job.
- Persisting the complete output. The tail is the record; the full stream is live-only.
- Reworking onboarding beyond the create step, or moving it to the chat-based flow PLAN §DESIGN
  sketches.

## Decisions

### A `jobs` table with a `kind`, not a `project_add_jobs` table

`upgrades` is purpose-named because there is exactly one upgrade concept and it is daemon-level. Here
the ticket already names the general shape ("long-running steps such as adding a project"), and a
`kind` column plus a `JOB_KINDS` enum in `shared` costs one column and one enum while keeping
`/jobs/:id` and the UI component generic. `JOB_KINDS = ['project_add']` today; adding a second kind
later is a new enum member and a new step list, not a new table, a new route and a new UI component.

Alternative considered: hanging the steps and log off the `projects` row. Rejected — it makes the
concept unreusable, and it puts a growing blob on a row read on every dispatch.

### Sub-steps are a fixed list per kind, stored as JSON on the row

`steps_json` holds `[{ id, label, state, startedAt, endedAt }]` in order, seeded complete-and-`pending`
when the job is created. This is what lets a surface draw the whole sequence immediately, and it keeps
the read to a single row. The step ids for `project_add` come from the existing pipeline and are named
in `shared`: `clone`, `resolve_branch`, `declare`, `openspec`, `knowledge`, `ticket`.

Alternative considered: a `job_steps` table. Rejected — six rows per job, no query that needs them
separately, and an extra join on every read.

### Output lines: a live in-process bus, a bounded tail on the row

`jobs.log_json` keeps the last `JOB_LOG_LINES = 200` lines (`{ seq, step, stream, text }`), exactly the
`UPGRADE_LOG_LINES` pattern. Every line is also pushed to an in-process emitter that the SSE route
subscribes to, so a connected client sees every line even though only the tail is kept.

Consequence, stated so it is not a surprise: a client that attaches late, or reconnects after being
away longer than 200 lines, gets the tail and then the live stream — it does not get the lines it
missed in between. The spec's replay requirement is over the retained tail, and that is the trade-off
for never growing the record. `run_events` chose the opposite (persist everything) because a turn is
the product; a clone's stdout is not.

Writing every line to the row would be 200 `UPDATE`s a second on a noisy install; instead the row is
rewritten at most every `JOB_LOG_FLUSH_MS = 250` (and always on a step transition and at the end),
with the in-memory tail as the truth in between.

### The stream is the run-events loop, re-pointed

`GET /api/w/:ws/jobs/:id/stream` copies `packages/server/src/routes/runs.ts`: replay from the record,
then `Pump` + heartbeat, frames named `job.step` / `job.log` / `job.finished`, `id: <seq>`, resumed by
`?after=` or `Last-Event-ID`. Both existing consumers (`EventSource` in the UI, `client.stream` in the
CLI) work against it unchanged.

The workspace outbox gets two new event types, `job.started` and `job.finished`, and nothing per line —
so a surface that is not watching the job still learns a project finished being added.

### `POST /projects` answers 202; `projects.add` keeps its shape

`projects.add(actor, cfg)` still runs the whole pipeline and resolves with the finished project — the
tests and `reconcile()` keep working, and an agent tool that adds a project would use it. The route
calls a new `projects.startAdd(actor, cfg)`, which creates the row and the job, kicks the same pipeline
off unawaited, and returns `{ project, jobId }` with `202`. Both funnel into one internal
`runAdd(project, cfg, job)`, so there is one pipeline, not two.

This is a breaking wire change and is called out as such: any caller that read the finished project out
of the `201` body now reads a `cloning` project and must follow the job (or poll `GET /projects/:id`).
The only in-tree caller is the CLI, changed in the same PR; `docs/API.md` is updated.

Alternative considered: keeping the request open and streaming progress in the response body
(chunked/NDJSON). Rejected — it does not survive a reload, gives nothing to a second surface, and
leaves the four-minute request in place.

### Retry is a route on the project, not a re-`POST`

`POST /projects/:id/retry` runs only when the project's status is `error`, otherwise `conflict`. Keying
it on the project id — rather than re-`POST`ing the same config to `/projects`, which today throws
`conflict` on the duplicate slug — keeps the create path's meaning intact and makes the UI's Retry
button one call with nothing to re-send. `clone()` already no-ops when `.git` exists
(`packages/core/src/projects/index.ts:28`), so a retry after a failed OpenSpec adoption does not
re-clone; the clone sub-step reports `done` immediately.

A job is refused while another job for the same entity is `running`, which is what stops a
double-clicked Retry from running two pipelines over one clone.

### Streaming a child's output: an `onLine` option on `sh`

`sh` gains `onLine?: (stream: 'stdout' | 'stderr', line: string) => void`. When present it consumes
execa's `stdout`/`stderr` streams line by line as they arrive, still resolving with the same
`ExecResult` (the buffered text is accumulated as before, so no caller changes). `git()` forwards the
option. This is the same seam `packages/release`'s `run()` uses (`onOutput`), kept in the shape `core`
already has.

Only the three long commands pass it: `git clone`, `openspec init`, `git push`.

### Onboarding resumes from a small localStorage record

The create step writes `{ workspaceId, steps: [{ label, kind, jobId? }] }` under a single
`ac.onboarding.resume` key as it goes, and clears it when the human leaves for the new workspace. On
mount, if the record names a workspace that exists, the flow restores the create step and re-attaches
each job by id. `GET /jobs?kind=project_add&entity=<projectId>` is the fallback when the record is
missing but the project is known.

Alternative considered: deriving the resume state purely from the server (list running jobs for the
workspace). Rejected as the primary path — before the first step finishes there is no workspace id to
ask about, and the flow needs the human's chosen labels and order to redraw the list.

### Elapsed time

Timings come from the job (`startedAt`/`endedAt` per step) so a reload shows real durations rather than
restarting a client-side clock. Steps not backed by a job — create workspace, configure conductor — are
timed in the client, which is all they need, and the spec says so.

## Risks / Trade-offs

- **The 202 breaks any external caller of `POST /projects`** → called out as BREAKING in the proposal
  and in `docs/API.md`; the response still carries the project row, so a caller that only wanted "it
  was accepted" is unaffected, and one that wanted the finished project polls `GET /projects/:id` or
  follows the job.
- **A missed window in the log** (attaching after more than the retained tail) → accepted, documented
  above; the failure case that matters keeps the last lines, which is where the error is.
- **A job orphaned by a daemon restart** → settled to `failed` at startup with a message naming the
  restart, and the project is left `error`, which is exactly the state Retry handles.
- **Unhandled rejection from the unawaited pipeline** → `startAdd` attaches the terminal handler
  itself; the pipeline's own `catch` already writes the failure to the project row, and the job's
  wrapper catches anything else and fails the job rather than letting it escape.
- **Line-splitting a command that writes progress with `\r`** (git's counters) → carriage returns are
  treated as line breaks when splitting, so a clone shows its progress rather than one enormous line.
- **The new UI component is jsdom-hostile** (auto-scrolling a `<pre>`) → the progress list is tested
  through injected job data as props, following DecisionCard rather than mocking `../api/hooks`.

## Migration Plan

`0009_jobs.sql` creates one new table and touches nothing existing; there is no backfill and no data
to convert. Rollback is dropping the table — no other table gains a column or a foreign key to it.

The daemon is deployed by the human's `conductor daemon upgrade` after the merge; the web app is built
into the same release, so the 202 and the client that understands it ship together. A stale CLI pointed
at a new daemon prints the project it was given without progress, which is today's behaviour.
