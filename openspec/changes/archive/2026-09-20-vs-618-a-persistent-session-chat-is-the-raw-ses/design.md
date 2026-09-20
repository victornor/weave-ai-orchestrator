## Context

See proposal.md — Why. The machinery is already in place and this change composes it rather than
building a renderer:

- A ticketless persistent session (`kind='session'`, `ticket_id IS NULL`) talks to the human through
  one workspace-owned thread. `deliverSessionAnswer` (`packages/core/src/runs/engine.ts`) posts the
  turn's trimmed final text to that thread as an outbound agent message carrying the run id, or a
  plain-reason notice when the turn failed/timed out/cancelled/interrupted; for a *succeeded* turn
  with no final text it posts one system notice, `This turn ended without an answer.`
- The web surface is `SessionThreadFeed` (`packages/ui/src/v2/WorkerPage.tsx`): the thread's messages
  plus one `LiveTurnSection` for the current run, held until the thread carries a message with that
  run id, then replaced. It never lists the session's runs and shows no past turn's transcript.
- The transcript renderer is pure over a run's `RunEvent[]`: `packages/ui/src/components/Transcript.tsx`
  (`Transcript`) already renders assistant text, tool rows, `edit`/`write` as diffs, written-file
  previews, command rows with output and syntax highlighting, via `lib/transcript.ts` →
  `runEventsToTranscript`. `RunTranscript` is `Transcript` plus a self-scrolling box and the live
  partials/activity row.
- Run↔message association available today: an outbound message carries `runId` and, for the session
  answer, `replyToMessageIds` back to the waking human message. An inbound human message carries
  `runId: null`. A run carries `wakeupIds` but no thread id, and the runs API does not expose wake
  payloads. The runs list supports `?agent=`.
- VS-616 made the session live turn read like the worker live view, and its design rejected
  `RunTranscript`'s nested scroller for the session chat: the session chat scrolls the page.

## Goals / Non-Goals

**Goals**

- A succeeded session turn that produced no final text is a normal, complete turn: no notice, no
  error.
- The session chat is the raw session: each turn's full transcript, interleaved with the human's
  messages, live while it runs and unchanged after it ends.
- The final text appears exactly once.
- A ticketless session is not instructed to produce a formatted report; the weaver keeps its rules.
- Reuse the existing transcript components; one page scroller; no schema change.

**Non-Goals**

- Changing the worker, weaver or planner transcripts or their rules.
- A cross-channel session transcript; the thread delivery for Telegram is kept as a delivery
  channel, not as the web chat's source.
- Backfilling past sessions or touching historical thread rows.
- Reconciling the two `runEventsToTranscript` implementations (`packages/ui` vs `packages/render`) —
  pre-existing drift (`run-transcripts`), not this change.
- A new endpoint, migration or dependency.

## Decisions

### D1. The empty-answer system notice is removed for sessions; outcome notices stay

In `deliverSessionAnswer`, the `succeeded` branch stops posting anything when the trimmed final text
is absent, whitespace-only or parses as the structured run report — it returns instead of writing
`This turn ended without an answer.` The report-shaped guard stays so a runtime cannot leak report
JSON into the conversation; it now writes nothing rather than a notice.

`sessionOutcomeNotice` is untouched: a turn that failed, timed out, was cancelled or was interrupted
still posts one system notice naming the plain reason. That wording is the turn's real cause, not the
"no response" wording; the ticket keeps it.

- **Alternative considered:** keep the notice but change its wording. Rejected — captain's rule is
  that a turn with no final text is complete, so the notice has no place at all.
- **Why the report guard survives:** sessions are no longer told to produce a report (D5), but a
  runtime could still return one; writing report JSON into a chat is a leak, writing nothing is not.

### D2. The session conversation is rendered by interleaving runs and thread messages

`SessionThreadFeed` stops being "messages + one live section". It builds the conversation from two
sources and renders it in order:

- the thread messages from `useThreadMessages`;
- the session agent's runs from `useRuns({ limit: 200 })` filtered by `agentId` (the query
  `useWorkerRun` already makes, so it is shared and cached, not an extra request).

A pure helper, `sessionConversationRows(messages, runs, sessionAgentId)`, returns ordered rows:

- **message** rows for inbound human messages, system notices, and messages from another agent (a
  weaver relay);
- **turn** rows for the session's runs, ordered by `startedAt ?? createdAt`;
- the session's own outbound answer messages — `direction:'outbound'`, `authorKind:'agent'`,
  `authorId === sessionAgentId`, with a `runId` — are dropped from the message list. Their words are
  the run's final text and appear in that run's transcript (D4).

Rows sort by time (`message.createdAt` vs the run's `startedAt ?? createdAt`), with a stable
tie-break on the row key, so a reload rebuilds the same order. A run is not linked to its waking
message by id (inbound messages carry no run id); time ordering places each run after the human
message that woke it, which is what the surface shows.

- **Alternative considered:** persist a `thread_id`/`message_id` on the run (a migration). Rejected —
  the display order is derivable, and a migration for a rendering concern is not warranted.
- **Alternative considered:** reuse `chatRows`/`useRunTraces` (the weaver chat). Rejected — it
  renders collapsed `ChatTurnTrace` rows, not the full worker transcript the ticket asks for.

### D3. One scroller: the page, not each turn

The conversation keeps scrolling as one page (VS-616's constraint). A turn renders through a small
`v2/SessionTurn.tsx` that composes the existing pieces the way `RunTranscript` does, without its
scroll box: `Transcript` for the run's persisted events, plus — while the run is live — `LivePartials`
(streamed text) and `LiveActivity` (the state row). `useRunEventStream(runId, { live })` supplies the
merged events and partials, so a live turn streams and a finished turn reads the same component from
its persisted events. No second scroller, no `useStickToBottom`, no "Live run output — not sent yet"
label (that label is the weaver/planner chats' rule; a session's words are its own).

- **Alternative considered:** extend `RunTranscript` with a `scroll=false` mode. Rejected — it owns a
  `useStickToBottom` hook and a `role="log"` scroller that a non-scrolling caller would carry for
  nothing; composing its pieces is smaller and keeps the worker feed untouched.

### D4. The final text is shown once, with a safety net

The delivered answer message is not rendered by the surface (D2). The transcript is where the final
text appears. Because a runtime may report its final text outside the recorded event stream (Codex
reads a last-message file; a Claude `result` can be a summary), `SessionTurn` receives the delivered
answer text (if any) and, when the finished turn's transcript produced no assistant-text block,
renders that text as the turn's closing text. So an answer is never lost and never shown twice.

- **Alternative considered:** render the answer bubble and remove the final text from the transcript.
  Rejected — the ticket states the transcript already holds the final text and the raw session is the
  display; suppressing the transcript's own text would make the transcript lie.

### D5. A ticketless session gets a conversation instruction, not the worker delivery "now"

`whatToDoNow` (`packages/core/src/prompts/index.ts`) returns `WORKER_DELIVERY_NOW` for a ticketless
session — "do the phase your ticket status asks for … finish with the structured final report". A new
`SESSION_NOW` replaces it for `agent.kind === 'session'` with no ticket: answer the conversation in
its own words, write the reply as the final message (so a bound channel still receives it), with no
report format. A ticketed session keeps the worker instruction, exactly as it keeps the worker
instructions today.

The home `SESSION_TMPL` line ("Your final message text is posted to this conversation on your
behalf…") stays: it is how a session bridged to a channel gets its answer, not a tidiness rule.

- **Alternative considered:** scope `skillsFor` so a ticketless session is not installed
  `weave-ai-worker`. Rejected for now — `skillsFor` keys on `agent.kind`, and a session that takes a
  ticket does so as the same `kind`, so removing the skill risks the ticketed path unless the home is
  guaranteed re-rendered at that moment. The invocation (`whatToDoNow`) is removed instead; the
  residual is recorded in the audit below.

### D6. The weaver path is distinct and unchanged

No analogous engine notice exists for the weaver: `deliverSessionAnswer` returns immediately unless
`agent.kind === 'session' && ticket === null`. The weaver's rules are its prompt (`WEAVER_NOW`,
`weave_human_send`, the structured final report) and the weaver chat's own display rules
(`chatRows({ showSilent: false })`), all untouched. This change removes a rule that only ever applied
to sessions; "the weaver keeps it" holds because the weaver is not on the code path at all, and its
prompt rules are not edited.

### Audit — every place a no-answer notice or a final-message rule still applies

Read at `436bfa6c`. Scope named as **session** (ticketless persistent session), **worker**,
**weaver**, **planner**.

| # | Where | Rule / wording | Level | Change |
|---|---|---|---|---|
| 1 | `engine.ts` `deliverSessionAnswer`, `succeeded` + empty final text | posts `This turn ended without an answer.` | session | **removed** (D1) |
| 2 | `engine.ts` `sessionOutcomeNotice` | `failed`/`timed_out`/`cancelled`/`interrupted` plain-reason notice | session | kept (real cause, not "no response") |
| 3 | `engine.ts` `deliverSessionAnswer` final-text delivery | posts the answer to the thread | session | kept (channels; web no longer depends on it) |
| 4 | `engine.ts` `sessionReplyContext` | resolves the delivery target/quote | session | kept (delivery, not answer-shaping) |
| 5 | `prompts/index.ts` `WORKER_DELIVERY_NOW` via `whatToDoNow` | "do the phase your ticket status asks for … finish with the structured final report" | session (ticketless) | **replaced** by `SESSION_NOW` (D5) |
| 6 | `prompts/defaults.ts` `SESSION_TMPL` + `templates/session.AGENTS.md.tmpl` | "write your answer as your final message" | session | kept (channel delivery) |
| 7 | `skills/weave-ai-worker/SKILL.md` | "finish with the structured final report" | worker (+ residual: a ticketless session's home still installs it) | worker kept; invocation for the ticketless posture removed at #5; residual noted (D5) |
| 8 | `prompts/index.ts` `WEAVER_NOW`, `defaults.ts` `WEAVER_TMPL`, `skills/weave-ai-weaver` | reply only via `weave_human_send`; finish with the structured report | weaver | unchanged (weaver-only) |
| 9 | `prompts/index.ts` `PLANNER_NOW` | reply only via `weave_plan_reply` | planner | unchanged (planner-only) |
| 10 | `prompts/index.ts` `WORKER_DELIVERY_NOW`, `WORKER_TMPL` / `worker.AGENTS.md.tmpl` | ticket delivery phases; structured final report | worker | unchanged (worker-only) |
| 11 | `lib/chatPrefs.ts` "Turns with no reply", `ChatPage`/`PlanTab` `chatRows({ showSilent:false })` | the weaver/planner chat hides a no-reply turn | weaver/planner | unchanged (weaver/planner-only; not the session surface) |
| 12 | `INTERACTIVE_FIRST_TURN_NOW` / `INTERACTIVE_CONVERSATION_NOW` | the ticketed interactive-worker rules | worker (ticketed interactive) | unchanged |

Conclusion: after this change the only "no final message" notices are the session outcome notices
naming a real failure (#2), and every "rule requiring a final message" belongs to the weaver (#8),
the planner (#9) or the worker ticket protocol (#10), all untouched.

### D7. No schema, API or dependency change

The surface reads existing queries (`useThreadMessages`, `useRuns`, `useRunEventStream` /
`useRunEvents`); the engine change is one branch. No route, migration or package is added.

## Risks / Trade-offs

- **Many turns × one event query each.** Rendering the full transcript per turn asks for each run's
  events. → Only the loaded conversation window renders; `useRunEvents` is cached and deduped by key;
  a run whose events are bookkeeping-only renders nothing. If a long history proves heavy, a future
  change can virtualise, but it is not needed for the acceptance case.
- **A turn with no final text now leaves no thread row.** → The run's own transcript is the record;
  the human sees the tool work and the session is not "silently blank" because the transcript is
  there.
- **An answer not present in the events.** → The D4 safety net renders it once from the delivered
  text.
- **A retried turn appears as more than one transcript.** → Correct: each attempt is its own run and
  its own transcript; a failed attempt's notice names the reason.
- **Time ordering could interleave an unlinked run oddly.** → A run's `createdAt` is after the human
  message that woke it (same database clock); the stable tie-break keeps two rows in a fixed order.
- **The `weave-ai-worker` skill still installed for a ticketless session.** → Known residual (audit
  #7); the per-turn instruction no longer invokes it, and a follow-up can scope skills to the posture
  if it is observed to shape a session's replies.

## Migration Plan

No data migration, no backfill. After the daemon is upgraded, the next session turn posts nothing
when it has no final text, and the session page renders its turns as transcripts. Past sessions are
unchanged; their historical notices remain in the thread and render as system notices.

## Open Questions

None.
