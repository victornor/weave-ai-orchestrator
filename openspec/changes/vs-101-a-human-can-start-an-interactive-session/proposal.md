## Why

Captain (2026-09-07), the second half of the attach request: "This will also open the option for the
user to spawn an interactive session, letting them work directly with an agent, for say debugging or
running tests, where the human in the loop makes this whole conductor as a middleman less efficient."

**This supersedes an earlier version of this plan that captain rejected.** That version (ticketless
sessions, a `promote` disposition, a new `interactive_sessions` table) was proposed and approved
before a correction captain had already posted on this ticket — 2026-09-07 15:24, an hour before the
propose turn started — was read. Captain's correction: "I actually don't think a session should ever
be ticketless. An interactive session should start from a ticket too, letting the agent know that the
user may request to create a PR etc. at any point. So the agent should know how to manage its ticket.
The agent should wait for the user's first input before acting on the ticket or beginning anything."
The conductor caught the mismatch after approval and asked for a re-propose; the ticketless
implementation already committed has been reverted in full. This proposal is that re-propose.

Once a session always has a ticket, almost everything it needs already exists: `workers.spawn`
already provisions a worktree, a runtime and a role's charter/tools/permission mode for a ticket, and
`workers.message` already records a human's words on that ticket and delivers them mid-turn or queued
(VS-99), agent-scoped. What is genuinely new is small: a way to start a worker for a ticket on demand
rather than waiting for the supervisor's queue, a way to mark that ticket as a session so it is visible
as one, an enforceable (not just prompted) hold on the agent's first turn until the human has said
anything, and keeping the conductor out of it.

## What Changes

- **A ticket gains `interactive_session: boolean`.** Set when a human starts a session against it —
  either an existing ticket or one created in the same action — never by anything else. This is the
  session's whole persistent record; nothing else is added to hold it.
- **`WorkersService.startInteractiveSession`** resolves or creates the ticket, marks it, and calls the
  existing `spawn` unchanged — the same worktree, runtime and role-driven permission a supervisor-spawned
  worker gets, on demand rather than on the next tick.
- **The agent's first turn is held to a read-and-report allowlist, enforced by the runtime's own
  `--allowedTools`, not by prompt wording.** For an interactive ticket's worker, while `turnCount` is
  still `0`, `TurnInput.permission.allowedTools` is restricted to reading the ticket and its
  documents, checking the worktree, and posting one ticket comment — no edit, no command execution, no
  ticket transition, no PR. The brief for that turn says explicitly: state what you understand the
  ticket to be and what you are ready to do, then stop. From the second turn on — triggered by the
  human's first message, exactly like any worker's queued or mid-turn delivery — the role's ordinary
  permission mode applies and the agent manages its ticket exactly as any worker does.
- **The conductor cannot message an interactive session.** `workers.message` refuses when the caller
  is an agent (the conductor, via `ac_worker_message`) and the ticket is a session; a human caller is
  unaffected. The conductor can still read the run and the ticket, never write to either.
- **Ending an interactive session reuses the mechanics a worker's ticket already has** — `workers.cancel`
  leaves the ticket in whatever status it was in and keeps the worktree; discarding it still needs the
  existing worktree-discard route's explicit `force: true`. No new disposition, no promotion: the
  ticket was the record throughout, so there is nothing left to carry into a new one.
- **An idle interactive session cancels itself, worktree kept**, after a configurable quiet period
  with no run and no recent turn (`agents.lastRunAt`) — the same `workers.cancel` path, called by the
  supervisor instead of a human.
- **Visible wherever workers are.** `GET /tickets` and `GET /workers` already return the ticket/agent
  rows this reads from; both gain `interactiveSession` in their wire shape.

## Capabilities

### New Capabilities

- `interactive-sessions/start`: a human starts a session bound to an existing ticket or one created
  in the same action; the session's agent is that ticket's worker with the role's ordinary worktree,
  runtime, charter, tools and permission mode.
- `interactive-sessions/first-turn-hold`: the agent's first turn is restricted, by the runtime's own
  tool allowlist, to reading its ticket and posting one comment stating its understanding and
  readiness — no edit, command, transition or PR — until the human's first message; from the next
  turn on it manages its ticket exactly as any worker does.
- `interactive-sessions/lifecycle`: visible wherever a worker is, marked interactive; the conductor
  can read the run and the ticket but is refused if it tries to message the session; ending leaves the
  ticket in a stated status with its worktree intact and still requires the human's explicit word to
  discard unlanded work; an idle session cancels itself with its worktree kept; a daemon restart
  recovers its interrupted run exactly as it recovers any worker's, because it is one.

### Modified Capabilities

None. `agent-attach/input-record`'s "agent with no ticket" scenario (VS-99) is untouched — an
interactive session's agent always has a ticket, so it was never the case VS-99 refused.

## Impact

- `packages/db`: one additive migration, `ALTER TABLE tickets ADD COLUMN interactive_session INTEGER
  NOT NULL DEFAULT 0` — no CHECK, no rebuild, no FK, safe on a live database.
- `packages/shared`: `Ticket.interactiveSession: boolean`; `TicketCreateInput.interactiveSession?:
  boolean`.
- `packages/core`: `tickets/service.ts` (`create` accepts and stores the flag), `workers/index.ts`
  (`startInteractiveSession`, the `ac_worker_message`-from-conductor refusal in `message`), `runs/
  engine.ts` (the first-turn allowlist), `prompts/index.ts` (the first-turn "state and stop"
  instruction), `supervisor/index.ts` (the idle-cancel pass), `api.ts` (the new method and wire
  shapes).
- `packages/server`: `POST /tickets/:id/start-session` (or an existing-ticket + fresh-ticket variant),
  `GET /tickets`/`GET /workers` gain `interactiveSession`; `ac_worker_message`'s handler surfaces the
  new refusal.
- `packages/ui`: a way to start a session from a ticket, or from a project+role picker that creates
  one; a marker on the worker/ticket card.
- `docs/API.md`.

## Out of scope (per the ticket, unchanged)

- Multiple humans in one session.
- Changing what a role may do, or any approval gate.
- Terminal emulation.
