## Why

An interactive session's conversational instruction is gated on `agent.turnCount === 0`. From the second turn the agent is given the ordinary worker contract — deliver the ticket through propose → apply → merge — so a diagnostic chat (Captain, 2026-09-10, VOFM-19) produces a merge approval instead of an answer. The first-turn hold is correct and stays; the session-wide posture is what is wrong.

## What Changes

- Every turn of an interactive session, not only the first, is instructed as a conversation: answer, investigate, explain. It does not write code, transition the ticket toward delivery, or raise a plan or merge approval unless the human asked for changes in that conversation.
- The first-turn tool allowlist is unchanged. After the first turn the role's ordinary tools return, so when the human *does* ask for work the agent can join the standard flow (plan approval, then merge approval) without a new escalation flag or a bypass of those gates.
- An agent that thinks changes are warranted says so in the conversation and waits. It does not start planning while asking.
- The rendered worker brief and `AGENTS.md` for an interactive ticket carry the conversational contract (including definition of done). The worker skill states the same override so the phase table does not win on later turns.
- An interactive ticket that ends in conversation alone is not a liveness violation and is not flagged as a stalled worker. The existing idle-session cancel remains the session-end path.
- Non-interactive workers are unchanged.

## Capabilities

### New Capabilities

- `interactive-sessions/conversational-posture`: conversation is the default for every turn of an interactive session; escalation to delivery happens only when the human asks, through the ordinary gates; a conversation-only ending is complete success and is not treated as incomplete, stalled, or a liveness violation.

### Modified Capabilities

- `interactive-sessions/first-turn-hold`: the requirement that every turn after the first is an ordinary worker turn is rewritten so later turns stay conversational by default; the first-turn allowlist and the "human asked, then manage the ticket" scenario stay.
- `worker-supervision/stalled-worker-detection`: a worker whose ticket is an interactive session is never flagged as stalled.

## Impact

- `packages/core/src/prompts/index.ts` — session-wide "What to do now" text keyed on `ticket.interactiveSession`; `workerData()` exposes that flag for templates.
- `templates/worker.AGENTS.md.tmpl`, `templates/brief.md.tmpl`, `packages/core/src/prompts/defaults.ts` — conversational contract and definition of done when the ticket is interactive (both templates; VS-211: they independently repeat the same instructions).
- `skills/agent-conductor-worker/SKILL.md` — interactive-session override of the phase table.
- `packages/core/src/tickets/service.ts` `livenessViolations()` and `packages/core/src/supervisor/index.ts` `stalledWorkers()` — exclude `interactive_session`.
- Tests in `prompts/render.test.ts`, `runs/engine.test.ts`, `tickets/tickets.test.ts`, `supervisor/supervisor.test.ts`.
- First-turn hold in `runs/engine.ts` (`FIRST_TURN_ALLOWLIST`, `turnCount === 0`) is not moved and not widened.
- No schema, API, or new tool.
