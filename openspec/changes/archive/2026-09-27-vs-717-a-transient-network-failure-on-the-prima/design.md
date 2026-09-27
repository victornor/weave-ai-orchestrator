## Context

`fetchLanding` (`packages/core/src/projects/index.ts`) is the one place that runs `git fetch origin`
against a project's primary clone; it is shared by `ProjectsService.fetch` and `checkSync`, and through
`fetch` reaches every one of that method's callers: the curation freshness gate
(`packages/core/src/runs/engine.ts`), `GET /:id/sync` and `POST /:id/fetch`
(`packages/server/src/routes/projects.ts`), the supervisor's serial `reconcilePass`
(`packages/core/src/supervisor/index.ts`, one project after another before it reconciles PRs, merges
and archives), `archiveAfterMerge`, and the knowledge repo-switch fetch. On failure it throws an
`OcError`, which the curation gate turns into a `checkout_stale` park; every other caller either
propagates it to an HTTP response or logs and moves on. See proposal.md for why the curation gate's
first-failure park is too eager for a transient network error.

**Revision (post-review):** the first version of this change made the retry unconditional inside
`fetchLanding`, so every caller above inherited up to ~2 minutes of backoff on a transient failure —
not just the curation gate, which is the only one that can afford it (it already blocks a single
ticket either way). A GitHub outage would otherwise have turned `reconcilePass`'s serial per-project
fetch into minutes of added latency across the whole workspace. The retry is now opt-in per call:
`projects.fetch(id, { retryTransient: true })`, used only by the curation gate; every other caller,
`checkSync` included, keeps the pre-existing single-attempt behavior with no code changes at those
call sites.

## Goals / Non-Goals

**Goals:**
- Retry only fetch failures that look like a transient network/transport fault; leave everything else
  (auth, missing repo, real divergence) parking on the first failure, unchanged.
- Make the classifier and the retry loop unit-testable with no real git network call and no real
  delay.
- Make the retry strictly opt-in per caller, so a caller that does not ask for it keeps today's
  single-attempt behavior with zero change to its own code or latency.

**Non-Goals:**
- Changing `engine.ts`'s curation gate's own logic beyond opting in, or the `checkout_stale` error
  code/shape. It already parks on whatever `fetchLanding` throws; retrying earlier means it now throws
  less often, and the message it does throw states the attempt count.
- Retrying the `merge --ff-only` / divergence-recovery step in `fetch()` — that failure is a content
  question (is the clone's history reachable from origin?), not a network one, and a retry cannot
  change its answer.
- A configurable retry policy. The bound (3 attempts, ~2 minutes) is fixed in code, matching the
  ticket's "for example" figure; nothing today needs it tunable per project.
- Opting in any other caller (`checkSync`, `reconcilePass`, `archiveAfterMerge`, the knowledge
  repo-switch fetch, the HTTP routes). None of them blocks only one ticket the way the curation gate
  does, so none of them gets the retry until a ticket asks for it with its own latency budget in mind.

## Decisions

**Classify on the fetch's stderr text, not the thrown error's `.message`.** `fetchLanding` builds the
`OcError` message itself (truncated, prefixed); classifying the raw `ExecResult.stderr` inside the
retry loop, before that wrapping happens, keeps the classifier a pure function of the words git
actually printed.

**A pure classifier plus an injectable retry loop, both in `packages/core/src/util/git.ts`** (next to
the `git()` helper other project/fetch code already imports), rather than inlining the loop in
`fetchLanding`:
- `isTransientGitFetchError(stderr: string): boolean` — regex match against connect-timeout,
  connection-reset, DNS-failure and similar transport signals. Deliberately does **not** treat a bare
  "Could not read from remote repository" as transient by itself — that line also appears on an
  auth failure ("Permission denied (publickey)... fatal: Could not read from remote repository"), and
  misclassifying that as transient would retry a failure retrying can never fix.
- `fetchOriginWithRetry(cwd, timeoutMs, opts)` — runs the fetch, and on a transient failure retries
  with backoff up to the attempt bound. `opts.run` (defaults to the real `git(['fetch','origin'], …)`)
  and `opts.sleep` (defaults to a real `setTimeout`) are overridable, which is what lets a test drive
  "fails twice then succeeds" and "fails every time" without touching the network or waiting 2 real
  minutes. `opts.onAttempt` reports each attempt for the caller to log.

Alternative considered, for the classifier and retry loop themselves: mock the `git` module
(`vi.mock('../util/git.js')`). Rejected — every other test in `projects.test.ts` and `engine.test.ts`
drives real local git repos, and mocking just this one call would be the only place in those suites
that fakes git rather than running it, for no real gain over the injected `run`/`sleep` `git.test.ts`
already uses.

**The opt-in wiring itself (`{ retryTransient: true }` vs. default) is verified with a module mock, in
its own file.** A real local git repo cannot be made to fail with transient-looking stderr (a connect
timeout, a DNS failure) without a real network call, so proving "`checkSync`/a bare `fetch()` makes
exactly one attempt; `fetch(id, { retryTransient: true })` makes up to three" needs the low-level fetch
call faked. `packages/core/src/projects/fetchRetryOptIn.test.ts` does this the narrowest way available:
it mocks only `../util/git.js`'s `fetchOriginWithRetry`, forwarding to the real implementation with
`run`/`sleep` overridden (so the retry loop itself is still real, just fed a fake, always-transient
fetch and a no-op sleep), and leaves every other git call (clone, checkout, rev-parse) real. This mock
is local to that one file — `projects.test.ts` and `engine.test.ts` are untouched and keep driving real
git throughout.

**Backoff: delays of 30s then 90s between the 3 attempts (~2 minutes total), not exponential from a
smaller base.** GitHub's own transient blips in the two observed incidents cleared within about a
minute; a first retry at 30s catches that quickly, and the second at 90s covers a slower recovery
without holding the ticket for much longer than the "about 2 minutes" the ticket names.

**Attempt count surfaces through the existing error message, not a new field.** `fetchLanding` already
composes the string `engine.ts` uses verbatim as the block reason (via `String(e)`); appending
`after N attempts` there satisfies "say in the park reason that it retried N times" without adding a
parameter to the curation gate or the `checkout_stale` failure shape.

## Risks / Trade-offs

- [A still-down network burns ~2 minutes of the worker's dispatch slot before parking, instead of
  failing immediately] → acceptable: the ticket asks for exactly this bound, and a park still happens
  at the end, unchanged from today's behavior in the worst case.
- [A future transient signal not in the regex list is misclassified as non-transient and parks
  immediately] → the previous behavior for every case: this only ever adds retries, never removes the
  existing fallback of parking with a human-readable reason.
- [A future caller that would genuinely benefit from the retry forgets to pass `retryTransient: true`]
  → safe by construction: the default is today's single-attempt behavior, so forgetting the opt-in
  reproduces the status quo, never a new failure mode. The reverse mistake — a caller opting in that
  should not — is the one the review round above caught before it shipped.

## Migration Plan

None — the change lands in `packages/core`, ships with the daemon's next release, and needs no data
migration or manual step.
