## Why

A persistent session's web conversation assembles itself from two sources: the thread's messages and
the agent's runs. It reads those runs from the workspace-wide newest 200 (`useRuns({ limit: 200 })`)
and then filters by agent, so once the workspace is busy the session's own earlier turns fall outside
that shared window. Their delivered answers are then dropped (the surface renders a reply from its
run, not from the message) while the human's messages — which are thread rows — stay. Captain saw
exactly this on 2026-09-21 in the fern-ofm Backend Engineer session: 1556 runs in the workspace, only
the agent's newest 2 inside the window, so the earlier turns and their replies vanished.

The same session had also just been retired at an upgrade (the tool contract changed, VS-542) and the
next turn started a fresh session (`run.started` then `session.started`, not `session.resumed`). The
model therefore began the turn with none of the conversation, and nothing in the surface told the
human that the model's memory had been reset there. The persistent-sessions spec promises that
reopening resumes the same conversation with its prior context intact.

## What Changes

- **A session's turns are loaded for that agent, not from a workspace-wide window.** The conversation
  reads the session's own runs (`/runs?agent=…`) and loads earlier ones as the human scrolls back, so
  a retired session's turns are never pushed out by other agents' activity.
- **The boundary is visible.** Where a session was retired and a new one started, the conversation
  shows a marker naming the reason ("new session: the agent's tools changed at an upgrade"). The
  reason is recorded on the retired session row and exposed with the agent's sessions.
- **The model is not left blind.** When a session had to be retired involuntarily (a changed tool
  contract, or a long idle period), the first turn of the new session carries a bounded, compact
  account of the earlier conversation — the thread's human messages and the agent's delivered
  answers, in order — so the new runtime starts with the conversation's substance rather than nothing.
- **VS-542 is not weakened.** The retirement still happens and the new session still fetches the
  current tool definitions; the carried account is prompt text and cannot resurrect a stale contract.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `persistent-sessions`: a session's conversation shows every turn across retired sessions in order
  with a visible retirement boundary and its reason; an involuntary retirement carries a bounded
  account of the earlier conversation into the new session's first turn.

## Impact

- `packages/core/src/sessions/index.ts` — `forTurn` records why a session was retired (and returns
  it), instead of only flipping `status`.
- `packages/db/src/migrations/0061_session_retired_reason.sql` — a new nullable
  `agent_sessions.retired_reason` column.
- `packages/shared/src/enums.ts` — the `SESSION_RETIRED_REASONS` enum and its human wording.
- `packages/core/src/prompts/index.ts` — `buildTurnPrompt` renders the carried-over account when the
  session was retired involuntarily; `TurnPromptOptions` carries the reason.
- `packages/server/src/routes/workers.ts` — `GET /workers/:id` returns the agent's sessions
  (id, status, turn count, created/updated, retired reason).
- `packages/ui/src/v2/WorkerPage.tsx`, `packages/ui/src/lib/sessionConversation.ts` — agent-scoped
  run query, older-history loading, and a `boundary` conversation row.
- `docs/API.md` — the extended `GET /workers/:id` shape.
- Tests: `sessions.test.ts`, `prompts/render.test.ts`, `packages/server/test/workers.test.ts`,
  `packages/ui/src/test/v2worker.test.tsx`, `packages/ui/src/lib/sessionConversation.test.ts`,
  `packages/db/src/migrations.test.ts`.
