# Cut the tokens an interactive session wastes

Tracker change for [VS-462](weave://tickets/VS-462). A `task` ticket, so this change carries tasks
only — `skip_specs: true`.

## Why

An interactive session on ACME-84 (2026-09-14, opencode) cost ~526k fresh input tokens for two
questions. Three runs:

| run | purpose | steps | fresh input | cached input |
|---|---|---|---|---|
| `01M2H52X…` | opening turn: "post exactly one comment" | 9 | 120,593 | 396,928 |
| `01M2H5H5…` | question 1 (interrupted) | 14 | 238,604 | 1,079,808 |
| `01M2H5RW…` | question 2, resumed 0.2s later | 18 | 166,415 | 2,127,744 |

Output was ~9.5k tokens. Almost all the cost is the conversation re-sent on every model step, and
the first request of each run misses the provider cache and re-sends everything fresh.

## What changes

1. **Cheap opening turn.** An interactive session's first turn reads only the ticket and its
   comments, posts one comment, and stops. `engine.ts`'s `FIRST_TURN_ALLOWLIST` is narrowed to the
   ticket-read and comment tools (no `Read`/`Grep`/`Glob`, no worktree status), the prompt says so,
   and the restriction is enforced where the tools live: the MCP server scopes a first-turn run's
   `weave_*` tools to that same list (via a run-token claim), and the opencode adapter disables its
   native tools for the turn. Claude already honours `--allowedTools`; the run-token scoping is what
   makes the hold real on a runtime that ignores it.

2. **Batch tool calls.** The worker brief, the worker `AGENTS.md` and the `weave-ai-worker` skill
   tell every worker — not only interactive ones — to request independent reads in one step.

3. **Show cache misses.** Each run records its first model request's fresh-versus-cached split as
   `usage.firstRequest`. `weave_run_inspect` and the V2 run page surface it, flagging a first
   request that re-sent more than 50k tokens uncached.

## Out of scope

- Why the provider cache expires (separate scout).
- Changing models or providers.
- Compaction thresholds.