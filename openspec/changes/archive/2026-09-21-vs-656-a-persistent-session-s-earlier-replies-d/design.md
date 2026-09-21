## Context

See `proposal.md` — Why. The relevant machinery:

- `SessionThreadFeed` (`packages/ui/src/v2/WorkerPage.tsx`) assembles a ticketless session's
  conversation client-side from two queries: `useThreadMessages(thread.id)` and
  `useRuns({ limit: 200 })`. The runs leg is then filtered by `r.agentId === sessionAgentId` and by
  `(r.startedAt ?? r.createdAt) >= oldest` (the oldest loaded thread message). `/runs` is
  workspace-scoped, so `limit: 200` means the newest 200 runs **in the workspace**, not the agent's.
- `sessionConversationRows` (`packages/ui/src/lib/sessionConversation.ts`) drops the session's own
  delivered answer message and renders the reply from that run's transcript, so a run lost from the
  window takes its reply with it while the human's inbound message stays.
- `forTurn` (`packages/core/src/sessions/index.ts`) retires a session in three places — a changed
  tool contract (VS-542), an idle session, and a runtime change — by flipping `status` to
  `stale`/`closed` and starting a new row with the same `agent_id`. It records no reason.
- The new session's first turn gets no account of the earlier conversation: `sessionStale` only adds
  a bootstrap knowledge digest, and `deliverSessionAnswer` (VS-596/618) is about the answer, not
  context. The runtime starts empty because a changed tool contract cannot be resumed (VS-542).
- `runs.session_id` is written at finalize and is the one durable link from a turn to the session it
  ran under. `agent_sessions.updated_at` is the retirement instant.

The fern-ofm evidence (read-only): agent `01M2Y0MMXNDD42SGRAFQ2JTE91` had 6 turns across retired session
`01M2Y0PXM268EZ431JFQGWTN4N` and 2 under the new session `01M32WB79R1WCVYBG5KD4V37NS`; the workspace
had 1556 runs and the newest 200 began at `2026-09-20T23:33`, so only 2 of the agent's 8 runs were in
the shared window. The retired session's `tool_contract` (`8f73…`) differs from the new one
(`511a…`). No database was modified.

## Goals / Non-Goals

**Goals**

- The conversation shows every turn of the session agent, across retired sessions, in order.
- A retirement leaves a boundary with its reason, derived from stored data.
- An involuntary retirement gives the new session a bounded account of the earlier conversation.
- One additive migration; no change to the runtime adapters.

**Non-Goals**

- A server-side "transcript" endpoint or a rewrite of the conversation assembler.
- Backfilling `retired_reason` for sessions retired before this change (they render a generic
  boundary).
- Summarising with a model: the account is a deterministic digest of stored messages, not a new
  inference call.
- Changing the worker, weaver or planner transcripts.
- Carrying the conversation across a runtime change the human chose.

## Decisions

### D1. The session's runs are fetched for that agent, and older history is paged in

`SessionThreadFeed` stops reading the shared workspace window. It reads the agent's own runs from the
existing `/runs?agent=<id>` filter, through a small `useSessionRuns(agentId)` hook, newest-first with
a named page constant (`SESSION_RUNS_PAGE = 200`). The feed keeps a `windowPages` count and requests
`limit = SESSION_RUNS_PAGE * windowPages`; the thread's existing `loadOlder` is wired to a
near-the-top scroll so both sources page back together. The `>= oldest` clause is dropped: the run
window is the agent's own, which is the set of turns the surface exists to show, so intersecting it
with a message-page cursor only hides turns that belong on screen.

- **Alternative considered:** keep `useRuns({ limit: 200 })` and raise the limit. Rejected — the
  window is still workspace-wide, so the same starvation returns as the workspace grows; the bug is
  the scope, not the number.
- **Alternative considered:** a new server endpoint returning the merged conversation. Rejected — the
  two existing queries already carry everything; the fix is which rows each selects, and VS-618
  deliberately avoided a new endpoint for this surface.
- **Alternative considered:** request all of the agent's runs unbounded. Rejected — an old session can
  have many turns; paging tied to the thread keeps the render bounded while making the whole history
  reachable.

### D2. The retirement reason is stored on the session row and shown as a boundary

`forTurn` sets `retired_reason` on the row it retires: `tool_contract`, `idle`, `runtime`, and
`reset` from `reset()`. A migration adds the nullable column; `SESSION_RETIRED_REASONS` is the shared
enum and a shared helper maps a reason to its human sentence ("the agent's tools changed at an
upgrade", "the conversation had been idle for a long time", "the session's runtime changed", "the
session was reset"). `forTurn` returns the reason it retired under, so the engine can pass it to the
prompt.

`GET /workers/:id` returns the agent's sessions (id, status, turn count, created/updated, retired
reason), oldest-first. The surface places the boundary from the runs' own `session_id`: when a run's
session id differs from the previous rendered run's, a `boundary` conversation row is inserted before
it, carrying the **previous** session's stored `retiredReason` (an unknown/absent one renders the
generic "the conversation restarted"). Placement by `session_id` is exact and needs no timestamp
comparison; the reason comes from storage, so it is not re-derived from the current contract/runtime.

- **Alternative considered:** reuse `agent_sessions.last_error` for the reason. Rejected — that column
  already means "the last error", is written by `record` and `reset`, and reading it as a retirement
  reason would be a lie waiting to happen.
- **Alternative considered:** derive the reason by comparing the retired row's `tool_contract` to the
  current hash. Rejected — it cannot distinguish an idle retirement, and the current hash has moved on
  by the time the surface is read.
- **Alternative considered:** show the boundary from the session rows alone (by `created_at`).
  Rejected — the run is what renders the turn, and its `session_id` already says which session it
  belongs to; timestamps can tie.

### D3. The carried account is a bounded digest of the conversation already stored

When `buildTurnPrompt` builds the first turn of a session that was retired involuntarily
(`tool_contract` or `idle`), it appends a `## Conversation carried over` section. The account is
built only from the agent's own thread messages already in the database — inbound human messages,
the agent's delivered answers, and system notices — in order, and excludes the message(s) waking the
current turn (their ids are on the wakes, the same ids `sessionReplyContext` resolves). No model call
and no new storage are involved.

Contents and bound (stated for the plan, as the ticket requires):

- **Selection:** newest messages first until the budget is spent, then presented oldest-first.
- **Per-message cap:** 1,500 characters; a longer message is truncated with `…`.
- **Total cap:** 12,000 characters (roughly 3,000 tokens on the daemon's `o200k_base` counter).
- **Message cap:** at most 40 messages.
- **Omission line:** when older messages were dropped, a one-line "N earlier messages omitted".
- **Formatting:** one line per message, prefixed `you:`, the role's name, or `system:`.

The account is prompt context only: it is not written to the thread, is not the human's message, and
does not change the turn's delivery.

- **Alternative considered:** summarise with the old runtime before retiring. Rejected — it needs a
  live coding-CLI invocation (forbidden from a ticket, and the retired session's contract is
  invalid), adds a spawn to every retirement, and produces a non-deterministic artefact.
- **Alternative considered:** resume the old session with its context. Rejected — impossible under a
  changed tool contract; that is exactly why the session is retired.
- **Why this is safe:** the account is the same text the human already sees in the conversation, it
  is bounded, and it can only add context — it cannot make the runtime hold a stale tool contract.

### D4. A chosen runtime change stays uncarried

`setSessionOption` moving to another runtime is announced before it is applied and the spec says the
conversation restarts with no prior context. The engine passes the retirement reason, and
`buildTurnPrompt` carries the account only for `tool_contract` and `idle`; `runtime` and `reset` stay
empty, so the surface's statement remains true. The boundary marker is still shown for every reason.

### D5. VS-542 is untouched

The retirement branch and the new-session creation are unchanged except for writing the reason. The
first turn of the new session is spawned exactly as today, so the runtime fetches the current tool
definitions; the carried account rides in the turn prompt text only.

## Risks / Trade-offs

- **The digest could leak a message the human considers private into the reloaded context** → it is
  the same thread the session already owns and already sees; no other thread is read.
- **A very long earlier conversation is only partly carried** → bounded and stated; the newest part
  is kept, and the omission line tells the model the account is partial.
- **`session_id` is null on runs recorded before it was written** → no boundary is drawn for those
  runs; a new session's runs all carry it, so the boundary still appears from the first retired
  session with ids onward.
- **Paging runs and messages together could thrash a very long conversation** → both queries are
  cached by key and only grow on an explicit scroll-back; the initial page is unchanged in size.
- **A reason recorded by the running daemon is not present on rows retired before the migration** →
  the generic boundary wording covers it.

## Migration Plan

One additive migration, `0061_session_retired_reason.sql` (`ALTER TABLE agent_sessions ADD COLUMN
retired_reason TEXT;`). No backfill. Rollback is a deploy of the previous release; the extra column is
ignored by older code. The daemon archives the change as part of landing; the human runs
`weave daemon upgrade` afterwards.
