# V2 Plan modal: the planner conversation renders exactly like the weaver chat

Tracker change for [VS-442](weave://tickets/VS-442). A `task` ticket, so this change carries tasks
only — `skip_specs: true`.

## Why

Captain asked twice (2026-09-14) for the planning chat to be *entirely* like the weaver chat — "it's
just a different context". VS-428 scoped only the composer, so the conversation itself never matched:
`PlanModal` renders each message as a plain `<p className="whitespace-pre-wrap">{m.body}</p>` bubble,
with no markdown, no per-turn summary and no live working trace.

The planner already records everything the weaver chat renders — the plan thread's outbound planner
message carries a `run_id`, the planner agent's runs have `usage_json` and a full `events.jsonl` — so
this is a UI change, plus one small server gap (the planner's own `runtimeId`, needed to resolve the
session size in the turn summary; see below).

## What changes

- **One shared conversation view.** The weaver chat's conversation rendering is extracted out of
  `ChatPage` into `v2/ChatConversation.tsx`: the scrolling message list (`ChatMessage`), each turn's
  `ChatTurnTrace`, the live working section (its `useRunEventStream`, the working indicator and the
  `ChatTrace reveal`), and the stick-to-bottom follow with its scroll button. Both `ChatPage` and
  `PlanModal` render this one component; neither keeps a second copy of the markup.
- **The differences are parameters, not forks.** The shared view takes its rows/traces, its live run
  (the weaver agent for `ChatPage`, the plan's `agentId` for `PlanModal`) and its actor name
  ("weaver" / "Planner" in the summary, "Weaver is working" / "Planner is working" on the live
  section). `ChatTurnTrace` gains the actor name so a planner turn reads
  "Planner did N tool calls · tokens · session size".
- **Planner context.** The modal hides weaver-only affordances rather than showing broken ones: no
  inline decision cards, no reply-to-message control, no dispatch chips and no unattributed-worker
  row (the planner files no tickets and raises no decisions). Resolved ticket references still render
  as clickable tags through the shared `ChatMessage`. The drafts pane and the composer (VS-428) are
  unchanged.
- **Parity.** Styling, stick-to-bottom scrolling (VS-425), the streaming reply reveal (VS-425), live
  trace streaming (VS-433 / VS-440) and short file-name labels (VS-437) all behave identically,
  because they are the same code.
- **One server gap.** `POST /projects/:id/plans/start` returns the planner agent's `runtimeId` as
  well as its id and status, which is what the modal needs to resolve the planner model's context
  window for the summary's session figure. Undefined stays graceful: no window means no `ctx` part.

## Out of scope

Planner capabilities and draft-ticket behaviour; the composer (VS-428, VS-431, VS-432, VS-435,
VS-439, VS-441); resuming a planner turn that was already in flight when the modal opened (the plan
API exposes no `lastRun`, and the weaver chat's resume is not part of the parity the ticket asks for).