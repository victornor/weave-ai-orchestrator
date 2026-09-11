## 1. Detection primitive

- [x] 1.1 In `packages/core/src/worktrees/landed.ts`, add `unlandedCommitCount(input: LandedInput): Promise<number>` implementing design decision 2 (absent worktree/clone → 0; `merge-base --is-ancestor` → 0; `git cherry` `+` count; git failure → 0 + warn log). Verify with unit tests in the same file's test block: a branch with a commit not on the landing branch counts 1; an ancestor branch counts 0; a branch whose commits are patch-id equivalent (cherry-picked) counts 0; a missing worktree path counts 0.

## 2. The gate

- [x] 2.1 In `packages/core/src/tickets/guards.ts`, add `hasEndingNote` to `GuardFacts` and reject `task → done` without a non-blank note with `OcError('validation', …)` naming both endings. Verify in `tickets.test.ts`: `task` `in_progress → done` without a note throws `validation`; the same call with a note passes the sync guard; a `scout`/`change`/`question` → `done` without a note is unaffected.
- [x] 2.2 In `packages/core/src/tickets/service.ts` `transition()`, add the async gate after `checkTransition` and before the write transaction: for `kind === 'task' && to === 'done'`, resolve the ticket's latest non-removed worktree, project clone and landing branch (`landingBranchOf`), call `unlandedCommitCount`, throw `OcError('worktree_not_landed', …)` naming `in_review` when the count is above 0. Verify in `tickets.test.ts` with a real temp git repo wired through a worktrees row (harness `addWorker` + a `worktrees` insert): a task branch with an unlanded commit is refused `done` and keeps its status; a no-commit worktree finishes at `done` with no `merge_approval` raised and the note recorded as a comment; a cherry-pick-equivalent branch is not refused; a ticket with no worktree row finishes at `done`.
- [x] 2.3 Update the exhaustive "matches the shared transition table exactly" test so its guard-satisfied call carries a note, keeping every legal edge green including `task → done`.
- [x] 2.4 Verify the unchanged delivery path by test: a task with commits records a PR work product, transitions `in_review`, gets a `merge_approval`; the `mergeDone` → `done` write is not refused (it bypasses `transition()`) — assert via the existing merge flow test extended to a `task` ticket.
- [x] 2.5 Verify other kinds by test: the existing `scout`/`question`/`change` flow tests stay green unmodified (except 2.3's note), demonstrating no behaviour change outside `task`.

## 3. Contract documents

- [x] 3.1 `packages/core/src/prompts/index.ts` `definitionOfDone('task', …)`: state both endings, the required note, and that `done` is refused while commits are unlanded. Verify in `prompts/template.test.ts`: the task text mentions both `done` and `in_review` and the note; change/scout/question texts are unchanged.
- [x] 3.2 `templates/brief.md.tmpl`: the two `task` rows of the done table state both endings (VS-211: this file independently repeats delivery language). Re-read `templates/worker.AGENTS.md.tmpl` and confirm its task line still names no status; if it does, fix it here too. Verify the rendered brief for a `task` ticket carries both endings and a non-task brief is unchanged.
- [x] 3.3 `skills/agent-conductor-worker/SKILL.md`: rewrite the `todo` (`task`) row (ends `in_review` or, with no unlanded commits, `done`) and add the ending-note line to Ticket rules. `skills/agent-conductor-worker/references/delivery.md`: add the no-commits preamble to the `pr` and `local-branch` modes, including the `worktree_not_landed` rejection path. Verify by reading the shipped text against the spec scenarios.

## 4. Docs

- [x] 4.1 `docs/PLAN.md` §12.3 task line describes the two endings; §6.2 `done` row's per-kind note mentions it. Add `docs/adr/0016-task-tickets-may-finish-at-done.md` with the reason.

## 5. Verification

- [x] 5.1 `pnpm lint && pnpm typecheck && pnpm test` green at the repo root; paste the summaries on the ticket.
