## Context

See `proposal.md` — Why. Ground truth verified against `origin/main`:

- A ticket's pull request is opened by the worker itself, with `gh pr create`, in
  `skills/weave-ai-worker/references/delivery.md:20`. `ForgeAdapter.createPullRequest`
  (`packages/plugin-sdk/src/index.ts:62`, `packages/core/src/forge/gh.ts:203`) exists but is only
  called by daemon flows: OpenSpec archive backfill (`packages/core/src/openspec/index.ts:213,242`)
  and knowledge-repo switch/delivery (`packages/core/src/knowledge/repoSwitch.ts:158`,
  `repoDelivery.ts:120`). There is no daemon path that opens a ticket's own PR, so acceptance test 1
  ("a ticket PR is created as a draft", fake forge only) requires adding one.
- `prState` (`gh.ts:157`) returns a rolled-up `ciState`; `rollupState` (`gh.ts:127`) answers `none`
  for an absent/empty rollup. It does not report the PR's draft state.
- The landing sequence is `attemptArchiveThenMerge`
  (`packages/core/src/tickets/archive-before-merge.ts:108`): fetch the landing tip, create a detached
  scratch worktree, rebase/archive/push the branch, then read `forge.prState` and merge. `mergeDone`
  (`packages/core/src/tickets/service.ts:1228`) composes it under the project lock.
- `autoMergeSweep` (`service.ts:1393`) advances an `in_review` ticket to `merging` when the rollup is
  not `pending`/`failure`; `rollupState`'s `none` passes it. The merge step, not the sweep, is where
  checks are awaited.
- `landingBranchOf` (`packages/shared/src/types.ts:14`) is the one resolver for a ticket's effective
  landing branch.
- Agent tools live in `packages/server/src/tools.ts` (a static `TOOLS` array, `scope`) and are gated
  by the closed lists in `packages/shared/src/tools.ts` (`COMMON_TOOLS`, `WEAVER_TOOLS`,
  `WORKER_ONLY_TOOLS`); `packages/shared/src/tools.test.ts` fails on any agent-facing prose naming an
  unregistered `weave_*` token.
- Ticket work products are written by `tickets.addWorkProduct` (`service.ts`), the service behind the
  `weave_ticket_work_product` tool.
- `requireCi` is a project policy defaulting to true (`packages/shared/src/config.ts:48`); a project
  with no CI sets it false. `canMerge`-style code reads it as `requireCi !== false`
  (`service.ts:1405`).

## Goals / Non-Goals

**Goals:** one CI run per landing, on the head that lands; draft ticket PRs opened by a deterministic
daemon path; the merge step brings a draft out of draft before it reads checks; no run on push to the
landing branch.

**Non-Goals:** the self-hosted runner (separate operational ticket); making the bounded
lock-released checks wait real (`archive-before-merge`'s existing requirement describes it, and this
change keeps the current `checks_pending` retry signal); changing who owns a merge or the merge
queue; branch protection on the forge (captain-owned).

## Decisions

### Decision 1: A new worker tool opens the ticket's PR, not `gh` and not auto-open

Add `weave_ticket_open_pull_request` (scope `worker`, registered in `WORKER_ONLY_TOOLS`). It calls a
new ticket service method that resolves the ticket's pushed branch, the project's forge adapter and
`landingBranchOf`, opens the PR with `draft: true`, and writes the `pull_request` work product. It is
idempotent: it first asks `forge.pullRequestForBranch` for an open PR and returns it unchanged.

- *Alternative — daemon auto-opens at delivery (B):* decided against; it moves who records the PR URL
  and changes the delivery flow more than the ticket needs.
- *Alternative — keep `gh pr create --draft` in the skill (C):* decided against; the draft flag and
  the work-product record would stay a per-worker memory test, and acceptance test 1 could not be a
  fake-forge test.
- The tool never shells out to a forge CLI: with `local-branch` delivery, or no forge that can open a
  PR, it returns a `validation` error and nothing is opened. This is the answer's explicit constraint.

### Decision 2: `draft` on create, and a `markPullRequestReady` on the forge adapter

`ForgeAdapter.createPullRequest` gains `draft?: boolean`; `GhForge` adds `--draft` to `gh pr create`.
A new optional `markPullRequestReady?(cwd, url): Promise<{ changed: boolean }>` runs `gh pr ready` and
treats "already ready" as success (`changed: false`). `changed: true` is what tells the landing
sequence it has just started a run that cannot have registered yet.

- `draft: true` is passed only where the daemon lands the PR itself: the ticket PR tool, and OpenSpec
  archive backfill (`openspec/index.ts`). The knowledge-repo switch (`repoSwitch.ts`) and knowledge
  delivery (`repoDelivery.ts`) are merged by a person on GitHub, so they stay non-draft and need no
  "mark ready" step; their call sites are left alone and a test asserts they are not asked for a
  draft.

### Decision 3: Landing marks ready after its final push, before it reads checks

`attemptArchiveThenMerge` calls `forge.markPullRequestReady` after the rebase/archive/push step and
before `forge.prState`. Ordering matters: a rebase push while the PR is still a draft starts no CI, so
the transition to ready is what starts the single run on the head that will land. Marking ready at
merge-queue admission instead would run CI against every rebase the queue performs.

### Decision 4: A freshly-ready absent rollup is `checks_pending`, not a pass

After `markPullRequestReady` returns `changed: true`, a `none` rollup means the run has not registered
yet. When the project requires CI (`requireCi !== false`, the default), the sequence returns the
existing `checks_pending` outcome (the retryable `merge_checks_pending` error), so the landing is
retried after the checks appear. When the project does not require CI, `none` merges as today, so a
no-CI project pays no extra retry. A PR that was already ready is unaffected: `changed` is false and
its rollup is read exactly as before.

- *Alternative — poll inside the call:* rejected; it expands this ticket into the bounded-wait
  follow-up `archive-before-merge` already tracks.
- *Alternative — trust the forge's merge gate:* rejected; the daemon's own gate must not merge a head
  whose checks have not been seen.

### Decision 4b: A repository with no CI is detected; a forge that cannot say falls back to a bounded grace

`requiresCi` defaults true, and most projects never set it, so waiting on an absent rollup alone would
stall every landing in a repo with no CI (the merge review found `victornor/weave-services-plugin` has
no `.github/workflows`). Two additions:

- `ForgeAdapter.hasCiWorkflows?(cwd): Promise<boolean | null>`; `GhForge` answers with
  `gh api repos/{owner}/{repo}/actions/workflows --jq .total_count`, cached per clone for five
  minutes. `false` merges as before VS-393; `true` waits; `null` waits only for the grace.
- A bounded grace (`CI_NONE_GRACE_MS = 10 * 60_000`), measured from the first absent rollup for that
  pull request and remembered across the landing's retries in a module map. Past it, the sequence
  merges as a no-CI project and the caller records one line on the ticket. Ten minutes because
  GitHub's queued-run latency is seconds and this repo's slowest job is ~6.5 minutes, so a real run
  registers well inside it while a landing that would otherwise never happen is not stalled for more
  than the merge step already costs.

- *Alternative — make every project set `requireCi: false` when it has no CI:* rejected as a host
  patch; captain wants a general product fix.

### Decision 5: `ci.yml` guard per job, trigger with explicit types and a schedule

`pull_request` is given explicit `types: [opened, reopened, synchronize, ready_for_review]`, and each
job carries `if: github.event_name != 'pull_request' || github.event.pull_request.draft == false`
(GitHub has no workflow-level `if`). `push: branches: [main]` is removed and replaced by
`schedule: [{ cron: '0 6 * * *' }]` and `workflow_dispatch`. Job names and `concurrency` are
untouched.

## Risks / Trade-offs

- **A no-CI project would retry forever on an absent rollup.** → `hasCiWorkflows` reports none and the
  landing merges as before; a forge that cannot say is bounded by the 10-minute grace, after which it
  merges and records why (Decision 4b).
- **The archive-backfill landing (VS-389, in flight) merges a draft and must mark it ready.** → the
  mark-ready lives in the shared `attemptArchiveThenMerge`, so VS-389's landing inherits it on rebase;
  VS-389 stays out of scope here.
- **A knowledge-switch or knowledge-delivery PR would need a manual step if it were a draft.** → they
  are left non-draft; only daemon-landed PRs are drafts, and a test asserts the two human-merged call
  sites are asked for a non-draft.
- **`gh pr ready` on an already-ready PR is a non-zero exit.** → the adapter matches "already ready"
  and returns `changed: false`; the landing path is a no-op for pre-existing non-draft PRs.
- **Dropping the push-to-main run could let a bad merge sit unchecked.** → the merge queue only lands
  a head whose PR checks passed, and the daily `schedule` re-checks the landing branch.

## Sequencing

The weaver's plan review requires this change not to land before **VS-391**, which fixes the weak
wakeups that a `checks_pending` landing now depends on (`weave_schedule_wakeup`'s UNIQUE-constraint
failure, and no wake for the slot holder when CI finishes). Before requesting merge, rebase onto
`main` and confirm VS-391 has landed; if it has not, say so in the delivery report and do not merge.
Fernwood is unaffected: its own workflows still run on draft PRs, and the tool uses `landingBranchOf`
(`edge` for Fernwood), not the repository default.

## Migration Plan

No schema or config change. The `ci.yml` change takes effect the moment this ticket's own PR merges,
which is also the first PR to open as a draft. Deploy is the existing daemon upgrade; if the daemon is
reverted, the tool simply stops existing and the `ci.yml` change stays (harmless).

## Open Questions

None.
