## Context

Verified against `origin/main` (`e6936a3f`) and the live `victornor/agent-conductor` forge.

**The gate.** `attemptArchiveThenMerge` (`packages/core/src/tickets/archive-before-merge.ts:185`)
decides whether a landing may merge by reading `ciState` from `ForgeAdapter.prState`
(`packages/plugin-sdk/src/index.ts:45`). `GhForge.prState`
(`packages/core/src/forge/gh.ts:176`) computes it with `rollupState`
(`packages/core/src/forge/gh.ts:146`), whose per-check classifier `checkState`
(`packages/core/src/forge/gh.ts:48`) maps `SUCCESS`, `NEUTRAL` and `SKIPPED` to `success`. A merge
proceeds when `ciState === 'success'` (`archive-before-merge.ts:272` → `forge.mergePr` at `:273`).

**Real bytes.** `gh pr view 380 --json statusCheckRollup` for the VS-446 merged head
`3996ecd96e…` returns five `CheckRun`s, every one `status: COMPLETED, conclusion: SKIPPED`, from a
single `pull_request` workflow run (id `34914223488`, created `00:41:35Z`). `gh api
repos/…/actions/runs?head_sha=3996ecd…` returns exactly that one run, `conclusion: skipped`.
VS-447's head `32816cf7ee` returns zero runs. Both landings merged.

**The green case has duplicates.** `gh api graphql … statusCheckRollup` for PR #377 (VS-445, head
`37de6fcf58…`, merged) returns **twelve** contexts: each of `lint`, `typecheck`, `test-ui`,
`test-core` and the four `test-core (shard n/4)` jobs appears twice — once `SKIPPED` from run
`34915846935`, once `SUCCESS` from run `34915846988`. So a rule of "every entry must be a completed
success" rejects a genuinely green landing; the skipped duplicates must be ignored, not failed.

**Timelines.** PR #380's timeline: force-push to `1756a84b` `00:41:10Z`, archive commit `3996ecd`
authored `00:41:30Z`, `ready_for_review` `00:41:32Z`, run on `1756a84b` cancelled `00:41:34Z`, run on
`3996ecd` (all-skipped) `00:41:35Z`. The push and the transition race, and the skipped push run —
whose `synchronize` payload snapshots the draft state at push time — survives while the real ready run
is cancelled. So the ordering of the ready transition and the push is load-bearing.

## Goals / Non-Goals

**Goals:** a landing merges only on a real completed success on the exact head it produces; an
all-skipped, cancelled or missing rollup never lands; the push that produces the landing head happens
while the pull request is out of draft.

**Non-Goals:** VS-464's dispatch priority; CI duration; the self-hosted runner (VS-394/395); branch
protection on the forge; the bounded, lock-released checks wait (still a follow-up).

## Decisions

### Decision 1: A skipped check carries no signal; a non-success is never a pass

`rollupState` ignores entries whose conclusion is `SKIPPED` (the draft-run artifact, which GitHub
reports alongside a real run's checks for the same head), and then:

- empty after ignoring skipped, or no entries at all → `none`;
- any `FAILURE`, `ERROR`, `TIMED_OUT`, `ACTION_REQUIRED` or `STARTUP_FAILURE` → `failure`;
- any entry not a completed `SUCCESS` (`NEUTRAL`, `CANCELLED`, `STALE`, `PENDING`, `QUEUED`,
  `EXPECTED`, no conclusion, or a status that is not `COMPLETED`) → `pending`;
- otherwise → `success`.

`checkState` (the per-check detail and `checkTally`) is derived from the same classifier, so a skipped
or neutral check is no longer shown or counted as `success`.

- *Alternative — "every entry completed success":* rejected; it rejects PR #377's real green rollup
  because of the skipped duplicates (above).
- *Alternative — dedupe by check name by timestamp:* rejected; the skipped jobs' `startedAt` is
  **later** than the successful ones (PR #377's skipped `lint` started `01:10:46Z`, its successful
  `lint` `01:05:28Z`), so "latest entry wins" would pick the skipped one.

### Decision 2: The exact head SHA is the one the landing produces

After any push, the scratch worktree's `HEAD` **is** the head the landing will merge. When
`prState.headSha` is reported and differs from that, the sequence returns `checks_pending`: the forge
has not caught up with the push, so its rollup is evidence about some other commit and must not be
read as a pass for this one. When the forge omits `headSha` the check is skipped, so non-GitHub
forges and existing fakes are unaffected.

### Decision 3: A repository with CI never merges on an absent rollup

`requiresCi` handling becomes: `hasCiWorkflows === true` → always `checks_pending` (never fall
through on the grace); `=== false` → merge as before; `=== null` (the forge cannot classify) → the
existing `CI_NONE_GRACE_MS` bounded wait, then merge with one ticket comment. The grace exists for a
repo the forge cannot classify, not for one known to have CI.

### Decision 4: Out of draft, then push

`markPullRequestReady` moves from **after** the push (`archive-before-merge.ts:242-245`) to **before**
it. The pull request is then out of draft when the rebased/archived head is pushed, so the
`synchronize` run's payload has `draft == false` and its jobs run on the head that lands. This is the
ticket's first named option; the second (re-trigger after `ready_for_review`) was rejected as it
needs a repo-specific workflow name or run id the daemon does not have.

Trade-off: marking a draft ready starts a run on the pre-push head, which the push's run then
cancels under `concurrency.cancel-in-progress`. That cancelled run is on a head that will not land,
and the surviving run is the real one on the landing head — the two-run cost is unchanged from today,
and the head that lands now gets a real run.

## Risks / Trade-offs

- **A skipped-only head on a repo with CI now waits instead of landing.** → That is the fix. With
  Decision 4 the landing head is pushed non-draft, so a real run appears; a repo with no CI still
  merges (Decision 3).
- **A `null`-classified forge still merges past the 10-minute grace.** → Pre-existing VS-393
  behaviour and spec requirement, deliberately kept; only `hasCiWorkflows === true` forbids it.
- **UI display of a skipped check changes from `success` to `pending`.** → Correct: a skipped check
  is not a pass. The `ForgeCheckState` union is unchanged.
