# ADR 0016 — A task ticket may finish at `done` when nothing needs landing

**Status:** accepted · 2026-09-11 · rewrites the planned `task` flow (PLAN §12.3), which previously
routed every task through `in_review`

## Context

Captain, 2026-09-11: "I think we need to be able to file tasks that does not necessarily require a
plan or a pr and merge." The state machine already permitted it (`TASK.in_progress` contains `done`),
but the worker contract did not: the skill, the rendered brief and `definitionOfDone()` all routed a
`task` to `in_review` unconditionally, so every chore produced a PR and a merge approval the human
had to answer. VS-213 showed the same shape: where the machinery permits a lighter path but the
contract only teaches the heavy one, agents take the heavy one.

## Decision

A task worker chooses its ending from what it produced:

- a diff that should land → `in_review`, work product, merge approval, merge queue — unchanged;
- nothing that needs landing → `done` straight from `in_progress`, with the ending and its reason in
  the transition note (which lands on the ticket as a comment). No work product, no merge approval.

The choice is enforced by the daemon, not narrated:

1. `task → done` is refused (`worktree_not_landed`) while the ticket's branch carries commits its
   landing branch does not contain — ancestry or patch-id equivalence counts as landed, so a
   squash-merged branch is not refused. The check reads the primary clone's shared refs, and fails
   open when git state cannot be read: the gate may refuse only what it can prove, and the
   landed-work test plus the discard rules still protect the worktree itself.
2. `task → done` without a non-blank note is refused (`validation`), so the ticket explains itself
   afterwards.

`mergeDone` writes `done` directly rather than through `transition()`, so the post-merge path can
never be refused by this gate. `change`, `scout` and `question` behaviour is unchanged.

## Consequences

- Chores, cleanups and config tweaks stop costing the human a merge approval.
- The note requirement touches the CLI's `conductor ticket transition --to done` (pass `--note`) and
  any daemon-internal task→done path; the error message names the two endings.
- Unlanded commits keep today's protections: a refused `done` leaves the ticket's status intact, and
  a worktree with uncommitted changes is still handled by the landed-work test and `ticket discard`.
