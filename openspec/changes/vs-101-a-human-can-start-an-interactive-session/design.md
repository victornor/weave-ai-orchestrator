## Context

See `proposal.md` — Why, for how this plan came to be rewritten. This section records what the
ticket-always-has-one model needs to reuse, and reach around, with evidence gathered before writing
this version (the underlying worker/worktree/permission mechanics were already read correctly the
first time; what changed is what to build on top of them).

### What already exists, unchanged by this plan

- `WorkersService.spawn(actor, ticketId, opts)` (`packages/core/src/workers/index.ts:59-144`)
  provisions a worktree, a runtime and the role's charter/tools/permission mode for any ticket with an
  `assigneeRoleId`, and is idempotent (returns the existing worker if one is already live). Nothing
  about it needs to change: an interactive session's agent is exactly this, called on demand.
- `WorkersService.message` (`workers/index.ts:229-260`) already records a human's words as a ticket
  comment before attempting delivery, and delivers mid-turn or queued (VS-99) — agent-scoped, not
  ticket-shaped, so nothing about *delivery* needs to change either.
- `runs/engine.ts:234-252` builds `TurnInput.permission` from `role.permission` for every turn.
  `packages/runtimes/claude/src/args.ts:97-105` turns `permission.allowedTools` into the CLI's own
  `--allowedTools` flag: **when `allowedTools` is non-empty, the CLI is restricted to exactly that
  list.** This is the enforcement mechanism for `interactive-sessions/first-turn-hold` — an actual
  tool-availability restriction, not prompt wording.
- `agents.turnCount` (`Agent.turnCount`) increments in `finalize` (`engine.ts:365`) after each turn
  completes; the value read while building a turn's `TurnInput` is always the count *before* this
  turn, so `turnCount === 0` unambiguously identifies an agent's first turn ever.
- `agents.lastRunAt` is stamped at every `finalize` (`engine.ts:366`) — "when did this agent's turn
  last finish." Good enough as the idle-cancel signal without adding any new column: a message either
  delivers mid-turn (a run is executing, excluded by the same running-run check `retireFinished` and
  the reverted `retireIdleSessions` already used) or queues a wake that a turn picks up within the
  dispatcher's poll interval, which then stamps `lastRunAt` again on completion.
- `ac_worker_message` (`packages/server/src/tools.ts:458-460`, `scope: 'conductor'`) calls
  `workers.message(ctx.actor, ...)` with an agent actor — **the conductor already has a live path to
  message any worker.** This is the gap `interactive-sessions/lifecycle`'s "the conductor never joins"
  requirement closes: nothing today refuses it.
- `assigneeHuman` on `Ticket` is unrelated (a ticket assigned to a human rather than a role,
  `tickets/service.ts:834`) — checked and ruled out as a reusable marker before choosing a new column.
- No route or tool spawns a worker for a ticket on demand today; `spawnForTicket` is called only by
  the supervisor's `spawnPending()` pass, on its next tick (within `TICK_MS`, 15s). Starting a session
  needs an immediate call, not a 15-second wait.
- `landedWorkTest`/`POST /worktrees/:id/discard` (`force: true` required) and `workers.cancel`
  (worktree left `dirty`, ticket commented, never discarded) are the existing "end" mechanics — see
  Decision 3.

## Goals / Non-Goals

**Goals:**

- The smallest change that satisfies the corrected acceptance criteria: reuse `spawn`, `message`,
  `cancel` and the worktree-discard route entirely unchanged in their observable contracts.
- Make "the agent waits" a fact the runtime itself enforces, not a hope about prompt compliance.
- Keep the conductor out of a session's turn without touching anything about how it inspects one.

**Non-Goals:**

- A new "end" method or a disposition enum. There is nothing left to dispose of once the ticket was
  the record throughout — `cancel` and the discard route already say what happens to the ticket and
  the worktree.
- Any change to `RuntimeCapabilities`, `spawn`'s signature or contract, or `message`'s ticket-comment
  recording. All three are correct as they stand for a ticket-bound agent.
- A general "restrict any turn's tools" mechanism. Only the first turn of a ticket marked
  `interactive_session` is restricted; every other turn on every other ticket is unaffected.

## Decisions

### 1. The marker lives on the ticket (`tickets.interactive_session`), not on the agent

The ticket is what a session's whole record depends on now — its comments, its status, its worktree
binding via `worker_id`. Marking the ticket rather than the agent means the marking survives a
relaunch or a replacement worker for the same ticket, and every place that already reads a ticket for
display (the board, the ticket page) reads this the same way. An `agents` column would need to be
re-derived or re-set on every respawn for no benefit — the "first turn" behavior it would gate is
already independently keyed on `agent.turnCount === 0`, which needs no persisted flag of its own.

*Alternative considered:* an `agents` column. Rejected for the reason above — it answers "was this
particular process started as a session" when what actually needs answering, for both the visibility
and the first-turn-hold requirements, is "is this ticket a session," which only the ticket can say
truthfully across a respawn.

### 2. The first-turn hold is an allowlist computed in `engine.ts`, keyed on `ticket.interactiveSession && agent.turnCount === 0`

```ts
const FIRST_TURN_ALLOWLIST = [
  'ac_inbox', 'ac_ticket_get', 'ac_ticket_comments', 'ac_ticket_comment',
  'ac_ticket_document_get', 'ac_worktree_status', 'Read', 'Grep', 'Glob',
];
```

Where `ticket?.interactiveSession && agent.turnCount === 0`, the turn's `permission.allowedTools`
becomes exactly this list regardless of the role's own `permission.allowed` — the restriction is a
ceiling under the role's permission, not a substitute for it, so a role that already denies one of
these tools still denies it (computed as the intersection, not a flat override, in case a role's own
`denied` list overlaps). `ac_ticket_comment` is on the list because the requirement is not silence —
the agent must post exactly what it understands and is ready to do; without it there would be no way
to satisfy that half of the requirement.

Once `turnCount` is no longer `0` (the second turn, triggered by the human's first message exactly
like any queued or mid-turn delivery), `permission` reverts to the ordinary
`role.permission.mode`/`allowed`/`denied` computation, unchanged. Nothing marks this transition
explicitly — it falls out of reading `agent.turnCount` fresh on every turn, the same value the row
already carries for unrelated reasons (progress notes, brief revisions).

*Alternative considered:* deny-list mutating tools (`Edit`, `Write`, `Bash`, `ac_ticket_transition`,
`ac_ticket_merge_done`, …) instead of allow-listing the safe set. Rejected — an allowlist is exhaustive
by construction; a denylist has to be kept in sync with every tool the daemon ever adds that can
mutate something, and missing one silently reopens exactly the hole this requirement exists to close.

### 3. Ending a session is not a new method — it is `workers.cancel` plus the existing worktree-discard route

A human "ending" a session means exactly what ending a worker's ticket already means: `cancel(actor,
workerId, reason)` stops any running turn, leaves the worktree `dirty` (kept) and comments the ticket
that it was cancelled with its branch and worktree kept "until the work lands or is discarded"
(`workers/index.ts:283-297`, unchanged). Discarding it afterwards, unlanded or not, is the existing
`POST /worktrees/:id/discard` route, which already refuses without `force: true` — the human's
explicit word, already built, already tested. Nothing new is added because both halves of "leaves the
ticket in a stated status with its worktree intact" and "discarding still needs the human's explicit
word" are already true of any worker's ticket.

*Alternative considered:* the `keep`/`discard`/`promote` disposition from the rejected plan. Dropped
entirely — `promote` existed only to carry a ticketless session's work into a ticket, which no longer
applies, and `keep`/`discard` map exactly onto `cancel`/`discard` above with nothing left to decide
that those two do not already decide.

### 4. Idle cancellation reuses `lastRunAt`, no new column, and calls `cancel`

A supervisor pass finds tickets with `interactive_session = 1`, a live worker, no run currently
`running`, and `lastRunAt` older than a configurable timeout, and calls `workers.cancel(SYSTEM,
workerId, 'idle interactive session')` — the same call a human's own "end" action makes. The worktree
is kept because `cancel` always keeps it; there is no separate "keep" path to build.

*Alternative considered:* a dedicated `interactive_sessions` table tracking `last_activity_at`
(the rejected plan's approach). Superseded — `agents.lastRunAt` already tracks the equivalent signal
for every agent, and adding a parallel timestamp for one ticket flag would be tracking the same fact
twice for no behavioral difference.

### 5. The conductor's refusal lives in `workers.message`, keyed on `actor.kind === 'agent'`

`message` already receives an `Actor`; refusing when `actor.kind === 'agent'` and the ticket is an
interactive session is a single added check before the existing ticket-comment/delivery logic runs.
`ac_worker_message` is the only conductor-facing caller today (`packages/server/src/tools.ts:458-460`)
so no other caller needs auditing. A human's own message — via the web/CLI channel, `actor.kind ===
'human'` — is unaffected.

*Alternative considered:* remove `ac_worker_message` from the conductor's tool list entirely when the
target ticket is a session. Rejected — the tool list is static per role/kind, computed without knowing
which ticket a given call will target; a runtime refusal in the service is the only place that can see
both the actor and the ticket at the same time.

## Risks / Trade-offs

- **A role whose own `permission.allowed` is narrower than the first-turn allowlist** still works
  correctly (Decision 2's intersection), but a role that denies, say, `ac_ticket_comment` outright
  would leave an interactive session's first turn unable to say anything at all. This is an existing
  role-configuration hazard (such a role could not usefully run an interactive session at all) rather
  than something this change introduces; out of scope to guard against a role denying the one tool
  this whole feature depends on.
- **A message that arrives while the first turn is still executing** cannot upgrade that turn's
  already-fixed `allowedTools` — it is delivered (mid-turn or queued) exactly as VS-99 already
  guarantees, but is only acted on once the restricted first turn ends and the second, normally
  permissioned turn begins. Turn 1 is expected to be short (read plus one comment), so this window is
  small; explicitly accepted rather than built around.

## Migration Plan

Additive only: `ALTER TABLE tickets ADD COLUMN interactive_session INTEGER NOT NULL DEFAULT 0`. No
CHECK, no FK, no table rebuild — a plain column add, safe on a live database with real ticket rows.
Rollback is dropping the column; no session-bearing ticket needs it to remain a valid ticket without
it (it degrades to an ordinary one, silently, if ever removed).

## Open Questions

None — the ticket's out-of-scope list and this design's non-goals cover what was deferrable.
