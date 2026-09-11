## Context

`TASK.in_progress` already contains `done` (`packages/shared/src/transitions.ts`), but every contract surface (`skills/agent-conductor-worker/SKILL.md` task row, `definitionOfDone('task', …)`, `templates/brief.md.tmpl` task rows, `references/delivery.md`) sends a task to `in_review` unconditionally. The daemon has no guard tying `done` to "nothing to land", so the lighter path cannot be taught without also being enforced — the ticket explicitly asks for enforcement with a test, not an instruction.

## Decisions

### 1. The unlanded-commit gate is an async gate in `transition()`, not a transition-table change

`transition()` already runs async gates between the sync guards and the write transaction (the OpenSpec `validateForProposed` gate). The task-done gate sits in the same place: when `t.kind === 'task' && to === 'done'`, before the transaction, count unlanded commits; throw `OcError('worktree_not_landed', …)` if any.

Why not the transition table: the table (`shared/transitions.ts`) is a pure graph and must stay git-blind. Why not `mergeDone`: the post-merge path writes `status: 'done'` via `touch()` directly (`tickets/service.ts`, `mergeDone`), never through `transition()`, so a merged ticket can never be refused by this gate — which is what makes the gate safe to apply to *every* actor, humans included (a human closing a task with unlanded commits gets the typed error and can cancel instead; that is the discard rule's protection, kept).

### 2. Detection: `unlandedCommitCount()` beside `landedWorkTest`

New function in `packages/core/src/worktrees/landed.ts`, same inputs as `LandedInput` (repoPath, worktreePath, branch, landingBranch), returning a number:

1. No worktree row for the ticket, or `worktreePath` absent on disk → `0`.
2. No project, or `clonePath` missing → `0` (nothing to land against).
3. `git merge-base --is-ancestor <branch> <landingRef>` in `clonePath` → success means `0` (fast-forward/merge-commit landed, or an empty branch).
4. Otherwise `git cherry <landingRef> <branch>` and count `+` lines (patch-id equivalents count as landed — squash and rebase merges included, same rule `landedWorkTest` applies).
5. Any git failure → `0`, logged at warn. Fail-open, on purpose: the retirement path's `landedWorkTest` fails closed ("cannot tell" ⇒ keep the worktree), and that asymmetry is safe — a stranded worktree is protected by `retireIfLanded` and the discard rules, whereas a task worker who can never reach `done` because a git read hiccuped has no lighter route to fall back to.

`landingRef` resolves via the existing `resolveBaseRef` (`origin/<landing>` preferred). The branch ref resolves in `clonePath` because worktrees share the repo's refs — the worker's commits land in `refs/heads/<branch>` of the shared object store as they are made, so no fetch is needed.

Which worktree: the ticket's latest non-removed `worktrees` row — the same query `mergeDone` uses for the branch. A `noWorktree` (curation) task has no row → `0`.

### 3. The stated ending is a required note, checked in the sync guards

`GuardFacts` gains `hasEndingNote` (a non-blank `input.note`); `checkTransition` rejects `task → done` without it with code `validation`. Keeping it in `guards.ts` keeps every stateful rule in one file and makes the exhaustive transition-table test the natural place to satisfy it (that test already builds a "guards satisfied" call; it gains the note for `task → done` cells). `transition()`'s note already becomes a ticket comment via `systemComment`, so the recorded reason costs nothing new.

### 4. Contract text: five surfaces, one of them deliberately unchanged

- `definitionOfDone('task', …)` (`packages/core/src/prompts/index.ts`): both endings, plus "state the ending in the transition note; `done` is refused while commits are unlanded".
- `templates/brief.md.tmpl`: the two `task` rows of the done table state both endings (VS-211 reminder: this template independently repeats delivery language — change it here, not only in code).
- `skills/agent-conductor-worker/SKILL.md`: the `todo` (`task`) row ends "`in_review`, or `done` when nothing needs landing (no unlanded commits — the daemon enforces this)"; one line in "Ticket rules" states the ending note.
- `skills/agent-conductor-worker/references/delivery.md`: a short preamble to the `pr`/`local-branch` modes: no commits → no PR, state the ending, finish at `done`; a rejected `worktree_not_landed` means you have commits — deliver through `in_review`.
- `templates/worker.AGENTS.md.tmpl`: **unchanged.** Its task line (`todo` (`task`/`scout`/`question`) → "do the work, deliver the artifact its kind requires, transition") names no status; the per-kind definition of done in the same rendered file carries the detail. Re-checked at apply time per VS-211 in case wording has drifted.

### 5. Documentation

`docs/PLAN.md` §12.3's `task` line becomes the two-ending flow; the §6.2 `done` row's per-kind note mentions the task ending. This rewrites a planned flow, so it ships with a short ADR (`docs/adr/0016-…`) recording why: the human asked for plan-less, PR-less tasks, and enforcement had to live in the daemon because the contract alone demonstrably does not hold (VS-213, same lesson).

## Risks / trade-offs

- Fail-open on unreadable git state could let a done through with commits stranded — mitigated: `retireIfLanded` still refuses to remove a not-landed worktree, so nothing is destroyed; only the retirement is deferred, as today.
- The note requirement touches the exhaustive table test and any human CLI flow (`conductor ticket transition --to done`) — the CLI passes input through, so `--note` is already available; the error message says what is missing.
- A task whose commits were pushed but not merged is refused `done` even if the human considers the work "delivered" — intended: unlanded commits are exactly what the discard rules protect; the human route is merge-then-done or cancel.

## Migration

None. No schema, API or tool changes; `done → in_progress` reopen and the merge queue are untouched.
