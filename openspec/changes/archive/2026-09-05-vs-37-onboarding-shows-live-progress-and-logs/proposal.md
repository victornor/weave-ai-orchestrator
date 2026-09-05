## Why

Adding a project through onboarding is one blocking `POST /projects` that can run for minutes and
reports nothing until it returns. The workspace owner watched `Add project vautoig` sit at `running`
for about four minutes with no indication of progress, no way to tell a slow clone from a hung one,
and — had it failed — nothing but a one-line error to act on. Every other long operation in the
daemon (a run, an upgrade) is observable while it runs; project add is the one that is not.

One correction to the report, because it changes what the sub-steps are: **project add does not run
the project's setup command.** The setup command runs when a worktree is created
(`packages/core/src/worktrees/git.ts:34`, and as a worktrunk pre-start hook from
`packages/core/src/worktrees/wtconfig.ts:30`). The minutes in `projects.add`
(`packages/core/src/projects/index.ts:100-146`) belong to `git clone` (900 s timeout), `openspec
init` (120 s) and the `git push` of the OpenSpec scaffold. The silence is the same either way.

## What Changes

- **A job is a durable record of a long-running daemon operation**, with an ordered list of sub-steps
  (each with its own state and timings) and a bounded tail of the output lines it produced. The first
  and only kind is `project_add`; the record survives a page reload and a daemon restart.
- **`projects.add` reports as it goes.** The pipeline is cut into named sub-steps — clone, resolve
  branch, declare, openspec, knowledge, ticket — and the child processes it runs (`git clone`,
  `openspec init`, `git push`) stream their output line by line into the job instead of being
  buffered until they exit.
- **`POST /projects` becomes asynchronous. BREAKING**: it answers `202` with `{ project, jobId }` as
  soon as the project row exists, instead of `201` with the finished project after the whole
  pipeline. A four-minute HTTP request was never a sound contract, and progress cannot be observed
  from inside the request that produces it.
- **New job endpoints**: read one job, list jobs (so a client that reloaded can find the job still
  running for a project), and an SSE stream that replays the job so far and then tails it — the same
  replay-then-tail shape as `GET /runs/:id/events/stream`.
- **A failed project add is retryable**: `POST /projects/:id/retry` re-runs the pipeline for a project
  left in `error`, reusing the clone that is already on disk.
- **Onboarding shows it.** Each step shows its state and elapsed time (retained once done); a step
  backed by a job also shows the active sub-step and a live tail of its output; a failed step shows
  which sub-step failed with its last lines and a Retry button. Reloading mid-step re-attaches to the
  running job instead of losing the flow.
- **`conductor project add` shows the same thing**: sub-steps as they start and their output lines,
  ending in the same summary it prints today. `--json` still prints one final project object.

## Capabilities

### New Capabilities
- `workspace-setup/setup-jobs`: what a job is — its sub-steps, its bounded log, its lifecycle, how it
  is read, streamed and retried, and what happens to one when the daemon restarts. Includes the
  sub-steps `project_add` is made of and the asynchronous `POST /projects` contract.
- `workspace-setup/setup-surfaces`: what the onboarding view and `conductor project add` show while a
  step runs, when it fails, and after a reload.

### Modified Capabilities

(none — no existing capability describes project add or onboarding)

## Impact

- `packages/shared`: job kinds, states, sub-step ids and the `Job`/`JobStep`/`JobLogLine` types; two
  new workspace event types.
- `packages/db`: migration `0009_jobs.sql`.
- `packages/core`: a `jobs` service (durable record + in-process line bus); `projects.add` split into
  reported sub-steps and a `startAdd` that returns immediately; `retryAdd`; an optional `onLine`
  callback on `sh`/`git` so a child's output can be streamed rather than buffered; startup
  reconciliation of jobs a previous process left running.
- `packages/server`: `POST /projects` → `202`; `POST /projects/:id/retry`; `GET /jobs`,
  `GET /jobs/:id`, `GET /jobs/:id/stream`; `docs/API.md`.
- `packages/cli`: `conductor project add` follows the job stream.
- `packages/ui`: the onboarding create step renders job progress, elapsed time, the log tail, failure
  detail and retry, and resumes after a reload.
- No change to worktree creation, to the setup command, or to anything a worker does.
