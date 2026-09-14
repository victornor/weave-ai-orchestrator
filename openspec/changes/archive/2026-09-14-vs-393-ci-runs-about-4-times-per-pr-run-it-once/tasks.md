## 1. The forge adapter opens drafts and can mark them ready

- [x] 1.1 Add `draft?: boolean` to `ForgeAdapter.createPullRequest` (`packages/plugin-sdk/src/index.ts`) and pass `--draft` from `GhForge.createPullRequest` (`packages/core/src/forge/gh.ts`) when it is true; verify `gh.test.ts` asserts the drafted flag is present when asked and absent when not.
- [x] 1.2 Add `markPullRequestReady?(cwd: string, url: string): Promise<{ changed: boolean }>` to `ForgeAdapter` and implement it in `GhForge` with `gh pr ready`; an already-ready pull request ("already ready" on stderr/stdout) resolves to `{ changed: false }`, a real failure throws, and a success resolves to `{ changed: true }`. Verify with fake-`gh` unit tests for all three.
- [x] 1.3 Pass `draft: true` only where the daemon lands the pull request itself: the ticket PR tool (task 2.1) and the OpenSpec archive-backfill calls (`packages/core/src/openspec/index.ts:213,242`). Leave the knowledge-repo switch (`repoSwitch.ts:158`) and delivery (`repoDelivery.ts:120`) non-draft, since a person merges them on GitHub; verify each call site's test asserts the draft it is asked for — `true` for backfill, absent/`false` for the two human-merged sites.

## 2. A worker tool opens the ticket's pull request as a draft

- [x] 2.1 Add a ticket service method that opens the ticket's pull request: resolve the ticket, its project and `landingBranchOf`; fail with a `validation` error when the project is not `pr` delivery or has no forge whose `createPullRequest` is present; if `forge.pullRequestForBranch` finds an open pull request for the ticket's branch, return it (recording the work product) and flip nothing; otherwise call `createPullRequest(..., { draft: true })` with the caller's title/body; then record the `pull_request` work product. Verify with a fake forge: creates a draft with the landing branch as base, reuses an existing open pull request, leaves a pre-existing non-draft pull request non-draft, refuses `local-branch` delivery, refuses a missing forge, and records the work product with the returned URL.
- [x] 2.2 Register `weave_ticket_open_pull_request` (scope `worker`) in `packages/server/src/tools.ts` and add it to `WORKER_ONLY_TOOLS` in `packages/shared/src/tools.ts`; it takes the ticket id and the pull request title/body and returns the URL and number. Verify with a `runTool` test against a fake forge and that `pnpm lint` (the agent-facing-prose guard) passes with the new name.

## 3. Landing marks the draft ready before it reads checks

- [x] 3.1 In `attemptArchiveThenMerge` (`packages/core/src/tickets/archive-before-merge.ts`), after the rebase/archive/push step and before `forge.prState`, call `forge.markPullRequestReady` when the forge provides it; thread a `requiresCi` flag through `ArchiveThenMergeOpts` from the caller (`service.ts:1284`, reading the project's `requireCi` policy). When `markPullRequestReady` reports `changed: true`, the project requires CI, and the subsequent rollup is `none`, return `{ kind: 'checks_pending' }` instead of merging. Verify with a fake forge: a draft is marked ready before checks are read; an already-ready pull request is a no-op and unaffected; a fresh-ready absent rollup reports checks pending and does not merge; a rebase push to a ready pull request waits on the fresh checks; a `requireCi: false` project still merges on `none`.
- [x] 3.2 Confirm the existing `merge_checks_pending` rejection still carries its retryable code and detail through `mergeDone`'s landing error handling, and that a ticket whose pull request was opened before this change (never a draft) merges exactly as before.

## 4. The workflow runs once per landing

- [x] 4.1 Edit `.github/workflows/ci.yml`: give `pull_request` the explicit `types: [opened, reopened, synchronize, ready_for_review]`, add `if: github.event_name != 'pull_request' || github.event.pull_request.draft == false` to each job, remove `push: branches: [main]`, and add a daily `schedule` and `workflow_dispatch`. Keep the four job names and the `concurrency` block unchanged.
- [x] 4.2 Validate the workflow YAML parses (e.g. a YAML parse check) and confirm in the PR diff that the only trigger changes are the four listed above.

## 5. Docs describe the new procedure

- [x] 5.1 Update `skills/weave-ai-worker/references/delivery.md`'s `pr` mode to push the branch and then call `weave_ticket_open_pull_request` instead of running `gh pr create`, and note that local-branch delivery is unchanged.
- [x] 5.2 Update `docs/PLAN.md` §11.4 (delivery) and §11.4's CI/merge wording so the delivery procedure and when CI runs match the code. Confirm `pnpm lint` is green (the prose guard sees the registered tool name).

## 6. Verify

- [x] 6.1 Run `pnpm lint`, `pnpm typecheck`, and the full suite with `XDG_CONFIG_HOME="$(mktemp -d)"`; report both suite blocks verbatim and state that the CI change is verified by the PR diff, not by a test.
- [ ] 6.2 Before requesting merge, rebase onto `main` and confirm VS-391 has landed (this change's `checks_pending` landings depend on its wakeups). If it has not, say so in the delivery report and do not merge.

## 7. No-CI repositories still land (merge-review fix)

- [x] 7.1 Add `ForgeAdapter.hasCiWorkflows?` and implement it in `GhForge` with `gh api repos/{owner}/{repo}/actions/workflows --jq .total_count`, cached per clone for a few minutes; `0` is "no CI", a non-number or a failure is `null`.
- [x] 7.2 In `attemptArchiveThenMerge`, merge on an absent rollup when the forge reports no workflows, exactly as before this change; otherwise wait, bounded by `CI_NONE_GRACE_MS` (ten minutes, remembered across retries), then merge and have the caller record one line on the ticket.
- [x] 7.3 Tests: a repo reporting no workflows merges on `none` after a push; a repo with workflows and a fresh `none` is still `checks_pending`; `none` past the grace merges with a single report; the grace persists across retries. Correct the PR body claim that a no-CI project merges without qualification.
