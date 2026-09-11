## Why

Captain, 2026-09-11: "I think we need to be able to file tasks that does not necessarily require a plan or a pr and merge."

The state machine already permits it — `TASK.in_progress` includes `done` (`packages/shared/src/transitions.ts`) — but the worker contract never mentions it. `skills/agent-conductor-worker/SKILL.md` routes every `task` to `in_review`, unconditionally, and the rendered brief's definition of done for a `task` says the same. So a config tweak, a cleanup, or any task whose whole output is not a diff still produces a PR and a merge approval the human must answer. Same shape as VS-213: the machinery permits the lighter path, the contract only teaches the heavy one, so the agent takes the only route it was told about.

## What Changes

- A task worker chooses its ending from what it actually produced:
  - produced a diff that should be reviewed and landed → `in_review` exactly as today (PR, merge approval, merge queue unchanged);
  - produced nothing that needs landing → finish at `done`, with the ending and its reason stated in the transition note, which lands on the ticket as a comment. No PR, no merge approval.
- The choice is enforced, not narrated: a `task` → `done` transition is rejected with `worktree_not_landed` when the ticket's branch carries commits not contained in its landing branch (ancestor or patch-id match, so a squash-merged branch counts as landed). A worktree that does not exist or cannot be read does not block.
- A `task` → `done` transition without a stated reason is rejected, so the ticket explains itself afterwards.
- The contract documents teach both endings: the worker skill's task row, `references/delivery.md`, the rendered brief's definition of done (file template and `definitionOfDone()`), and PLAN §12.3. `worker.AGENTS.md.tmpl`'s task line already says "deliver the artifact its kind requires" and names no status, so it stays as is.
- `change`, `scout` and `question` behaviour is unchanged; the gate is keyed on `kind === 'task'`.

## Capabilities

### New Capabilities

- `ticket-lifecycle/task-completion`: a task ticket with nothing to land finishes at `done` with no work product and no merge approval, provided the worker states the ending; a task whose branch carries unlanded commits cannot finish at `done` and must deliver through `in_review` as today.

### Modified Capabilities

(none — no existing capability specifies how a task ticket ends; `ticket-delivery/*` govern the in_review → merging path this change leaves alone)

## Impact

- `packages/core/src/tickets/service.ts` — async gate in `transition()` for `kind === 'task' && to === 'done'`: unlanded-commit check (git in the primary clone) and the required-note check. `mergeDone()` writes `done` directly through `touch()`, so the post-merge path never passes this gate.
- `packages/core/src/worktrees/landed.ts` — new `unlandedCommitCount()` beside `landedWorkTest`, reusing its ancestor/`git cherry` patch-id approach.
- `packages/core/src/prompts/index.ts` — `definitionOfDone('task', …)` states both endings and the required note.
- `templates/brief.md.tmpl` — the `task` rows of the done table state both endings (VS-211: this template independently repeats delivery language; `worker.AGENTS.md.tmpl` checked and needs none).
- `skills/agent-conductor-worker/SKILL.md` + `skills/agent-conductor-worker/references/delivery.md` — the task row and the delivery preamble offer the `done` ending and the guard's rejection path.
- `docs/PLAN.md` §12.3 task line (and the §6.2 `done` row's per-kind note); a short ADR since this rewrites a planned flow.
- Tests: `tickets/tickets.test.ts` (gate), `worktrees/landed` unit tests, `prompts/template.test.ts` (definition of done), the exhaustive transition-table test stays green (no worktree → no commits → `done` allowed).
- No schema, migration, API route or new tool.
