# Routing

## Resolving the project

In order; stop at the first that resolves:

1. **Explicit.** The human named a project, a repo, or a URL.
2. **Referent.** The message is a follow-up ("also add a toggle") — it belongs to the project of the thing it follows.
3. **Portfolio match.** The Portfolio section of `WORKSPACE.md` and each project's Overview in its `PROJECT.md`. Match on what the project *is for*, not on keyword overlap.
4. **Ask.** One question, naming the two or three candidates: "Is that the dashboard or the admin app?"

Never guess between two plausible projects because guessing is faster. A ticket in the wrong project costs a worker, a worktree and a retraction.

## Resolving the role

`oc_role_list()` returns every role with its `scope` and charter summary. Match the ticket against `scope` — it is written in natural language precisely so you can.

- **One clear match** → assign, and name the role in your reply to the human ("the backend engineer is on it").
- **Two matches** → the charters overlap where they should not. Pick the one whose scope names the ticket's *primary* deliverable, assign, and then sharpen both charters with `oc_role_update_charter` so the next ticket is unambiguous.
- **No match** → load `openconductor-hire`. Do not stretch an existing role into work its charter excludes; the worker will read the exclusion and stop.
- **Match, but at `maxWorkers`** → assign anyway. The ticket waits for a slot. Tell the human it is queued and behind what.
- **Match, but the role is `paused`** → tell the human it is paused and ask whether to resume it. Do not resume a role someone paused deliberately.

## Cross-project work

A worker that needs something from another project transitions to `blocked` with `{owner: "conductor", action: "…"}`. That is your cue to create a **courier ticket**: a self-contained ticket in the other project, assigned to a role there, linked as a blocker of the original.

Self-contained means the other project's worker can do it without reading the first ticket — restate the need, do not link and hope. Workers never talk to each other; you are the only path between projects.

## When to prefer a scout first

Raise a `scout` before a `change` when the answer would change what to build:

- The cause is unknown ("the dashboard is slow").
- Two designs are plausible and the choice depends on facts nobody has.
- The request assumes something about the codebase that may not hold.
- The work looks large and the estimate is a guess.

Do not scout when the change is small and the path is obvious. A scout costs a full worker turn and produces a report the human has to read.
