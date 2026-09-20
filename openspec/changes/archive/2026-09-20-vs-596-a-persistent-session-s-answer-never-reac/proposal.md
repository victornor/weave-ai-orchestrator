## Why

Captain messaged a persistent role session (VS-495) and never saw an answer: the turn finished after 554 s with a full, correct reply, but only captain's inbound message exists in the session's thread. A ticketless session has no reply tool at all (`weave_human_send` is weaver-only, `weave_ticket_comment` needs a ticket), and the run engine does not deliver a session's final text either — so whether the human ever hears back is left entirely to the model, and the model never posted.

## What Changes

- A successful persistent-session turn woken by a human message has its **final answer delivered to the session's own thread** as an outbound message attributed to the session, linked to the human message that woke it. The engine posts it; no reply tool is added and the human never has to trust the model to call one.
- **No double post**: if the turn already wrote an outbound message to that thread, the engine adds nothing.
- **Empty or whitespace-only final text** writes no answer message; the thread instead shows a system notice that the turn ended without an answer, so it is never silently blank.
- Delivery reads the turn's normalized result, so it works for **every runtime** a session can run on.
- The session prompt gains one line telling the session its final message is delivered on its behalf, so it writes its answer there and does not look for a reply tool.
- Scope is the ticketless session. The other agent kinds are checked and recorded (design.md): a ticket-bound interactive session answers through ticket comments, and the planner has `weave_plan_reply` — neither is without a reply path.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `persistent-sessions`: a session's turn answer now reaches its conversation thread automatically — delivery of the final text, reply linkage to the waking message, no double post when a tool already posted, and a stated state for a turn that produced no answer.

## Impact

- **Core**: `packages/core/src/runs/engine.ts` — a post-finalize delivery step for `kind='session'` turns with no ticket, using the existing `threads.outbound` / `threads.get` service (reply targets via the same `defaultReplyToMessageIds` path `weave_human_send` uses). `flattenWakes` (already exported from core) reads the waking `human_message` wakes.
- **Prompts**: `SESSION_TMPL` in `packages/core/src/prompts/defaults.ts` and `templates/session.AGENTS.md.tmpl` gain a line that the final message is delivered.
- **UI**: `packages/ui/src/v2/WorkerPage.tsx` `SessionThreadFeed` renders a `system`-authored message as a distinct notice rather than a chat bubble.
- **No** schema change, **no** new tool, and **no** change to the worker or planner reply paths. No backfill of the affected fern-ofm history.
