## 1. Open the ticket's pull request ready for review

- [x] 1.1 In `packages/core/src/tickets/service.ts`, stop passing `draft: true` from `openPullRequest` so the forge is asked for a normal pull request; update the `openPullRequest (VS-393)` test in `packages/core/src/tickets/tickets.test.ts` to assert the create call has no draft flag (and the reused-PR test still asserts the existing PR is returned unchanged). Verify: `pnpm vitest run packages/core/src/tickets/tickets.test.ts -t openPullRequest`.
- [x] 1.2 Update the `weave_ticket_open_pull_request` description in `packages/server/src/tools.ts` to say the pull request is opened ready for review and that a draft is corrected by the daemon; verify `pnpm vitest run packages/server/test/tools-open-pr.test.ts`.
- [x] 1.3 Update `skills/weave-ai-worker/references/delivery.md` step 4 and `docs/PLAN.md` §11.4: no draft, ready for review, and the one CI run the open starts. Verify: `rg -n "draft" skills/weave-ai-worker/references/delivery.md docs/PLAN.md` shows no instruction to leave a ticket's PR a draft.

## 2. Never raise a merge approval for a draft

- [x] 2.1 Add the `in_review` pre-write gate in `packages/core/src/tickets/service.ts`: resolve the ticket's open pull request, read `prState`, and when it reports an open draft, call `markPullRequestReady`; when the forge has no such capability or the call fails, throw an `OcError('pull_request_draft')` naming the PR URL and the required action, before any status write. Skip when there is no pull request work product, the project is not `pr` delivery, or the forge cannot be read (log and continue). Verify: new `tickets.test.ts` cases prove a draft is marked ready before `decisions.create`, an uncorrectable draft rejects the transition with `pull_request_draft` and leaves the ticket out of `in_review` with no merge approval, and a non-draft PR is not marked ready.
- [x] 2.2 Apply the same check in `repairApprovals` before it re-raises a stranded merge approval; on failure raise no card that pass and log. Verify: a `tickets.test.ts` case with an `in_review`, non-auto-merge ticket whose PR is a draft it cannot mark ready asserts `decisions.create` is not called for that ticket.
- [x] 2.3 Confirm the landing backstop is still in place and covered: `attemptArchiveThenMerge` marks a draft ready before reading checks, and archive-backfill PRs are still created with `draft: true`. Verify: `pnpm vitest run packages/core/src/tickets/archive-before-merge.test.ts packages/core/src/openspec/service.test.ts`.

## 3. Full verification and delivery

- [x] 3.1 Run lint and typecheck for the touched packages and fix anything they report. Verify: the project's lint/typecheck commands exit 0.
- [ ] 3.2 Run the full core/server suite and the full UI suite, one at a time, capped at 4 workers, and paste both blocks verbatim in the ticket report. Verify: both suites pass.
- [ ] 3.3 Commit, push the branch, open the PR (which this change makes non-draft), and transition the ticket to `in_review` with the PR as the work product.
