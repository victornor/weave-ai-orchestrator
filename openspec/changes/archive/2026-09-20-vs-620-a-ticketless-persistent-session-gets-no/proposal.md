## Why

VS-618 made a ticketless persistent session a raw conversation with no answer-shaping, and recorded two residuals in its own audit (design.md row 7 and the reply bookkeeping). A ticketless session's home still installs `weave-ai-worker`, whose text tells it to leave progress on a ticket and finish with the worker's structured report; and a turn that posts no message (a tool-only turn, per VS-618 a complete turn) leaves the human message counted unanswered, so a later retry or resume can re-quote it. Captain, 2026-09-20: a persistent session is a raw adapter session the daemon only relays and presents; it must not obey the worker's or the weaver's delivery rules. This closes both residuals after VS-618 landed.

## What Changes

- **Skills follow the session's posture.** A ticketless persistent session's home is installed only the skills whose `skills/manifest.json` audience applies to a session with no ticket — the `all`-audience set (`weave-ai-knowledge`, `weave-ai-artifacts`) — and never the worker-audience skill whose rules are ticket delivery. A session that takes a ticket gets the worker-audience skills at that moment, because taking a ticket re-renders its home, and drops back to the all-audience set when the ticket reaches a terminal status. The home marker records the posture, so a posture change re-renders even without that explicit call.
- **A completed tool-only turn counts as having answered its message.** The fallback that resolves a resumed or retried session turn's reply target stops at the later of the last agent-authored outbound and the start of the session's last successfully finished run — not only at an outbound. A later turn, retry or resume therefore quotes the second human message and never re-quotes one a completed tool-only turn already handled.
- **Audit.** Every remaining rule that makes a session's turn end in a message or report is listed with its disposition; what remains belongs to the worker, weaver or planner protocol, or is the session's channel delivery. The weaver's and worker's rules are unchanged.
- No API, migration, dependency or UI change.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `persistent-sessions`: a ticketless session's home installs only the all-audience (non-ticket) skills, with the worker-audience set installed on ticket checkout and removed on ticket finish; and the conversation-thread delivery fallback treats a completed tool-only turn as having consumed the human message it was woken by, so a message is never re-quoted or re-delivered on a later turn or resume.

## Impact

- `packages/core/src/workers/home.ts` — `skillsFor` keys off the agent's ticket posture (`kind` + `ticketId`), not `kind` alone; the home marker and `ensureHomeCurrent` re-render when the posture changes.
- `packages/core/src/runs/engine.ts` — `sessionReplyContext`'s fallback bounds the pending human messages by the session's last successfully finished run.
- Tests: `packages/core/src/workers/home.test.ts`, `packages/core/src/runs/engine.test.ts`, `packages/core/src/workers/workers.test.ts`.
- No `docs/API.md`, no migration, no dependency, no UI change.
