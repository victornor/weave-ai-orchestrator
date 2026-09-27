## Why

Twice in 17 hours (VS-703, 2026-09-26 22:04Z; VS-716, 2026-09-27 15:21Z) a curation turn's pre-flight
`git fetch origin` on the project's primary clone hit a one-off GitHub SSH connect timeout, and the
daemon parked the worker with `checkout_stale`, blocked the ticket on the weaver, and waited for a
human to press Retry. Both times a plain retry a minute or two later worked. A transient network
failure needs a person only because nothing retries it first.

## What Changes

- Classify a primary-clone `git fetch origin` failure as **transient** (connect timeout, connection
  reset, DNS failure, "Could not read from remote repository" following one of those) or **not**
  (authentication/permission failure, missing repository, or a real divergence).
- Retry a transient fetch failure with bounded backoff (3 attempts over roughly 2 minutes), logging
  each attempt, before falling back to the existing `checkout_stale` park — but **only for the
  curation freshness gate**, opted in explicitly (`projects.fetch(id, { retryTransient: true })`).
  Every other caller of the primary-clone fetch (`checkSync`, `POST /:id/fetch`, the supervisor's
  serial `reconcilePass`, `archiveAfterMerge`, the knowledge repo-switch fetch) keeps today's
  single-attempt behavior unchanged, since none of them blocks only one ticket the way the curation
  gate does — an unconditional retry there would turn a GitHub outage into minutes of added latency
  per project across all of them.
- When the retries are exhausted, park exactly as today, with the park reason stating how many
  attempts were made.
- A non-transient failure (or a real divergence) still parks immediately, unchanged.

## Capabilities

### New Capabilities
(none)

### Modified Capabilities
- `knowledge/curation-freshness`: the "fetch itself fails" path now retries a transient failure with
  backoff before blocking, and the block reason for an exhausted retry states the attempt count.

## Impact

- `packages/core/src/util/git.ts`: a fetch-failure classifier and a retrying `git fetch origin`
  helper, both unit-testable without a real network call.
- `packages/core/src/projects/index.ts`: `fetchLanding` (shared by `ProjectsService.fetch` and
  `checkSync`) uses the retrying helper, logs each attempt, and only actually retries when told to.
- `packages/core/src/api.ts`: `ProjectsService.fetch` gains an optional `{ retryTransient?: boolean }`
  second parameter, defaulting to off.
- `packages/core/src/runs/engine.ts`: the curation gate's one call site passes
  `{ retryTransient: true }`. No other caller of `projects.fetch` changes.
