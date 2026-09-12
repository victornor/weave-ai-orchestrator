# ADR 0017 — An operational ticket kind gates before the action

**Status:** accepted · 2026-09-11 · adds `operational` beside `scout` / `question` (PLAN §6.1 / §6.2 / §12.3)

## Context

Captain, 2026-09-11: deployments, upgrades and service management have no diff to review, so they
must not go through a PR. `scout` has the right *shape* (`todo → in_progress → done`) but its
deliverable is a report about the world, not a change to it. For a `change`, the gate comes *after*
the work: a PR exists, a human reads it, then it lands. An operational action is already done by the
time there is anything to read, so the gate has to come *before* the action.

Overloading `plan_approval` does not fit: the apply path moves a change ticket to `approved` /
`proposing`, YOLO auto-grants it, and the `plan` document key is reserved for the daemon digest.

## Decision

A new ticket kind `operational` reuses the scout transition table. No `proposing` / `proposed` /
`in_review` / `merging`. No OpenSpec bind.

The pre-action gate is a new decision kind `action_approval` (`approve` / `revise` / `reject`),
always human-owned. Writing the `action` document on an operational ticket supersedes and raises it.
YOLO and `proposalApproval: none` do not grant it. `weave_ask` cannot construct it. Approve and revise
leave the ticket `in_progress` and wake the worker (revise records feedback); reject cancels.

After the action: a `report` of what actually happened, and knowledge-base docs where applicable.
Repo documentation is a follow-up `change` ticket. `operational → done` is refused
(`worktree_not_landed`) while the branch carries commits its landing branch does not contain — no
task-style required note.

An open `action_approval` is already an action path (`livenessViolations` and the stalled-worker
scan skip any open decision). Named so it cannot be dropped.

Rebuilding `tickets` to widen the kind CHECK requires `Db.migrate()` to honour
`-- ac:foreign_keys_off` on the first non-empty line: SQLite's `PRAGMA foreign_keys` is a no-op
inside a transaction, and unlike 0010/0018 this rebuilds a referenced table.

## Consequences

- Deployments and service actions stop pretending to be scouts or chores-with-a-PR.
- The human sees the commands before they run; the worker cannot YOLO past that.
- Unlanded commits stay protected the same way VS-215 protected task `done`.
