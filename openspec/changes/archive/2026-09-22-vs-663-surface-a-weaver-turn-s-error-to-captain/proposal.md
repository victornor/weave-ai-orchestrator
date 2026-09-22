## Why

When the weaver's own turn fails at the model adapter (captain hit a 500 from the Claude adapter on 2026-09-22), the chat captain was looking at shows nothing: no failed-turn marker, no reason, not even that the daemon is retrying. The turn is auto-retried behind an apparently idle chat, so the human cannot tell a dead turn from a quiet one. Every other conversation surface has some failure notice; the weaver, whose only delivery is a tool call that a dead turn never reaches, has none.

## What Changes

- The daemon posts one system-authored notice into the weaver's own conversation when a weaver turn ends without an answer for a reason that will not be retried or resumed — a failed adapter call, a timeout, a cancel, or an interruption. The notice names a plain reason and carries no run ids or internals, and a turn that already delivered a reply does not also get one.
- While an automatic retry is scheduled for a failed weaver turn, the chat shows a non-persisted "retrying" state, so the human is not left with a silent gap. A transient blip that a retry resolves leaves no failure message; a sustained outage still ends in the single terminal notice above, not one message per attempt.
- The retry's due instant becomes readable on the run record (`scheduledRetryAt`), which is what lets the chat show "retrying" after a reload without narrating each attempt.
- The weaver chat renders `system`-authored messages as notices (centred, muted, attributed to System) rather than as a weaver reply bubble, the way the persistent-session conversation already does.
- Non-goals, called out in the ticket: no change to retry counts, backoff, adapter selection or error classification. The worker and persistent-session surfaces keep their existing failure behaviour — the persistent session already has this notice and is not changed; the worker already surfaces failure on its ticket.

## Capabilities

### New Capabilities
- `conductor-chat/failed-turn-notice`: what the conductor's own chat shows when one of its turns fails without an answer, and how an automatic retry is made visible without a message per attempt.

### Modified Capabilities
- `run-recovery/retry-ladder`: a scheduled automatic retry becomes readable on the run (its due instant), so a surface can show that recovery is in progress.

## Impact

- `packages/core/src/runs/engine.ts` — the finalize-time delivery path gains a conductor notice beside the session one; the retry branch already records `scheduled_retry_at`.
- `packages/core/src/threads/service.ts` — uses the existing `outbound`/`primaryThread`/`hasOutboundForRun` surface; no schema change.
- `packages/shared/src/types.ts` — `Run` exposes `scheduledRetryAt` (the column already exists; only the projection was missing).
- `packages/ui` — `ChatMessage`/`ChatConversation` render `authorKind === 'system'` as a notice; `V2ChatPage` renders the retrying state from the weaver's latest run. Shared with the planner chat, which gains the same notice rendering harmlessly.
- No migration, no new route. `docs/API.md` unchanged unless the run projection is documented there.
