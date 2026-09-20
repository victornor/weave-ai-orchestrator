## Context

See `proposal.md` — Why. A ticketless persistent session (`kind='session'`, `ticket_id IS NULL`, VS-495) has its conversation in a workspace-owned `channel_threads` row created by `threads.createOwned(sessionId)`; the human posts to it through `POST /threads/:id/messages` (`threads.inbound`), which enqueues a `human_message` wake carrying `payload.threadId` and `payload.messageId`. The session's turns run through the ordinary run engine (`packages/core/src/runs/engine.ts`), which finalizes a run and computes a `summary`, but never writes to the thread.

The only writers of an outbound thread message are the weaver's `weave_human_send` and the planner's `weave_plan_reply` (`packages/server/src/tools.ts`). A session's tool surface is `COMMON_TOOLS + WORKER_ONLY_TOOLS + SESSION_ONLY_TOOLS` (`toolNamesFor`) — no human-reply tool exists, and `weave_ticket_comment` requires a ticket it does not have. The fern-ofm incident (run `01M2Y0PXKSW5NF83KS91ZJ7M8M`, succeeded, `liveness: "empty"`) is the proof: a full `assistant.text` answer existed, and the thread held one message.

Relevant existing machinery this design reuses rather than adds:

- `threads.outbound(actor, threadId, body, { runId, defaultReplyToMessageIds })` — the one outbound write path; it stores `run_id`, resolves reply targets (`resolveOutboundTargets`, VS-449) and emits `thread.message`, which the web app already consumes for the thread feed.
- `flattenWakes(wakes)` (`packages/core/src/prompts/index.ts`, exported from core) — unpacks coalesced wakes so several human messages batched into one turn are all seen.
- `extractReport(finalText)` — the same helper `collect_result` uses to tell a turn's prose from a structured run report.

## Goals / Non-Goals

**Goals**

- A session's answer always reaches the human, on every runtime, without depending on the model calling anything.
- No double post when a turn does post a reply, and no blank thread when a turn answers with nothing.
- Keep the change inside the run engine and the session surface; do not touch worker or planner reply paths.

**Non-Goals**

- Backfilling the affected fern-ofm history or any past run.
- Adding a reply tool to the session, or changing its tool surface.
- Auto-delivering a worker's or planner's final text (see D7 for the check).
- Any schema/migration change.

## Decisions

### D1. The engine posts the answer; no session reply tool is added

The observed failure is precisely that the model did not call anything. Adding a session reply tool re-introduces the same dependency and needs per-runtime prompt/skill work; the engine posting the turn's own final text removes the dependency entirely and is runtime-agnostic. **Cost per turn:** zero extra model tokens and no extra model request — one local `thread_messages` insert (plus its `thread_message_search` index row and its activity row) on a successful, human-woken, ticketless-session turn only. Rejected alternative: a scoped `weave_session_reply`-style tool, for the reason above.

### D2. Delivery lives after `finalize`, in `executeRun`, guarded by the finished run's status

`finalize` computes the run's final `status` and is synchronous. Delivery is an async `threads.outbound` call, so it runs as a step in `executeRun` after `finalize` returns, acting only when all of:

- `agent.kind === 'session'` and the run's agent had no ticket (`ticket === null`);
- the finished run's `status === 'succeeded'`;
- the turn was woken by at least one `human_message` wake.

Idempotency/double-post guard: before posting, check whether this run already wrote an outbound message to that thread — `SELECT 1 FROM thread_messages WHERE run_id = ? AND thread_id = ? AND direction = 'outbound' LIMIT 1`. `threads.outbound` stores `run_id` (set by `weave_human_send` from the run token), so a reply tool that posted during the turn is visible here and suppresses the engine post. Posting is keyed to a run that is already terminal, so it runs at most once; the only failure window is a crash between `finalize` and this step, which loses the post (the status quo) rather than duplicating it.

Rejected alternative: post inside `finalize`'s transaction. `finalize` is synchronous and its DB transaction cannot wrap an async `outbound` call; re-implementing `outbound`'s message/search/reply/event writes to make it sync would duplicate the one outbound write path for no correctness gain.

### D3. The target thread and reply linkage come from the waking wakes

The thread is the `payload.threadId` of the first `human_message` wake (flattened through `flattenWakes`). Before posting, the thread is read and its `agent_id` verified to equal the session agent — a session must never post into a thread owned by another agent. Reply targets are the `payload.messageId`s of every `human_message` wake for that thread, passed as `defaultReplyToMessageIds`, so the answer quotes the message that woke it and a batch of messages is all linked (the same behaviour `weave_human_send` gets by default). If no human wake names a thread, nothing is posted.

### D4. The text is the trimmed final text, with a report-shaped guard

The body is `result.finalText` trimmed. If `extractReport(finalText)` returns a report (the runtime returned the structured run report as its final message), it is treated as no answer — sessions do not use the report schema, but a runtime must not be able to leak raw JSON into a conversation. If the trimmed text is empty, D5 applies.

### D5. An empty turn writes a system notice, not an answer message

For an absent or whitespace-only final text, no answer message is written; instead the engine writes one outbound message with `authorKind: 'system'` and a fixed body stating the turn ended without an answer. This rides the existing `thread.message` push (the page updates immediately), survives a reload, and matches the capability's existing "a system notice is not attributed to the human" requirement.

Rejected alternative: derive the state in the UI from the last run. It does not work: a normal successful session turn is classified `liveness: 'empty'` (a session emits no structured report), so `liveness` cannot distinguish "answered" from "no answer", and the run row stores no separate emptiness flag. Adding a column plus a worker-detail invalidation to derive the same visible result is more surface than one system message that the thread already knows how to show.

### D6. The session surface renders a system notice distinctly

`SessionThreadFeed` (`packages/ui/src/v2/WorkerPage.tsx`) renders a `system`-authored message as a centered, muted notice instead of a chat bubble; the session's own answer keeps its existing outbound bubble and role-name attribution (the `persistent-sessions` author-attribution requirement). No new query or event is needed — the answer and the notice both arrive through `thread.message`.

### D7. Check of the other agent kinds (the ticket's item 5)

- **Interactive session holding a ticket**: its human message on a ticket-bound thread lands as a ticket comment (`threads.inbound` → `tickets.comment`), and its reply surface is `weave_ticket_comment`, rendered by `WorkerFeed` on the ticket. It has a reply path; not the same gap.
- **Planner**: has `weave_plan_reply`, which writes to the plan's own thread (`tools.ts`), and its own plan surface. It has a reply path.
- **Anything else that answers a human**: the ticketless session is the only agent kind with no reply path; it is the subject of this change.

The same engine auto-post could later be generalised to the planner behind a "did the turn already post" guard, but that is a separate change and is out of scope here.

### D8. The session prompt says the final message is delivered

`SESSION_TMPL` (and `templates/session.AGENTS.md.tmpl`) gains one line: the session's final message text is posted to the conversation on its behalf, so it writes its answer as its final message and does not look for a reply tool. This is wording only; delivery does not depend on it.

### D9. A turn that ends without an answer states the plain reason

The delivery step is not limited to a successful turn. A human-woken ticketless-session turn that ends `failed`, `timed_out`, `cancelled` or `interrupted` posts one `system`-authored notice naming the outcome in the human's terms — "The turn failed: <reason>.", "This turn took too long and was stopped before it could answer.", "This turn was cancelled before it answered.", "This turn was interrupted before it answered." The reason is the agent's stored `error_text`, first line only, whitespace-collapsed and capped, with a family-based fallback (`provider_quota` → "the usage limit was reached", `model_unconfigured`, memory) so no run id or error internal reaches the thread.

A turn that is **not terminal** is left unannounced, because the daemon will retry or resume it and a notice now would only add noise before the real outcome:

- a retry already scheduled (`runs.scheduled_retry_at`, set for `transient_upstream`/`resource`);
- `interrupted_by_shutdown` (the next daemon resumes; wakes preserved);
- `interrupted_by_message` (the live human message starts the next turn);
- an authentication outage (`errorFamily='auth'`), which resumes on the same wake once the runtime is healthy.

`finalize` schedules the retry **after** it returns, so the delivery step re-reads the run row rather than trusting the snapshot it was handed. Rejected alternative: reading the outcome's severity from the agent row only — the agent status does not distinguish a cancelled turn (left `active`) from a retried one.

### D10. A retry wake carries the conversation context forward

A retry is a fresh wake with no `human_message` of its own, so without help a retried session turn would not know which thread (or message) to answer. `finalize`'s retry path now copies the thread and waking message ids from the failed attempt's wakes into the retry wake payload, and the delivery step reads the context from either a `human_message` wake or that carried payload (`sessionReplyContext`). Shutdown and auth resumes already preserve the original `human_message` wake, so they need nothing extra. Verified by a test: a retried turn that then succeeds posts exactly one answer and no earlier failure notice.



## Risks / Trade-offs

- **Crash between `finalize` and the post loses one answer** → the guard makes the post at-most-once and never duplicated; the lost case is the current behaviour (an unanswered thread) and is a tiny window. If it is ever observed the post can move to a retried repair step.
- **An outcome notice for a turn that later recovers** → only terminal outcomes are announced (D9): a scheduled retry, a shutdown/message resume and an auth outage are all skipped, so the human is told once, and only when nothing more is coming.
- **A failure message carrying internals** → D9 takes the first line only, collapses whitespace, caps the length and falls back to a family phrase; no run id is ever included (asserted by test).
- **A runtime that returns the report JSON as final text** → D4's `extractReport` guard treats it as no answer and writes the system notice instead of leaking JSON.
- **A future session reply tool posts after the engine step** → the run-id outbound guard suppresses the engine post; the tool's own message is the answer.
- **Thread ordering after a long turn** → the answer is inserted with `created_at = nowIso()` at post time, after every inbound message of the turn, so it reads last; covered by a test.
- **Two different threads in one coalesced turn** → only the first human-woken thread is used; a session's conversation is one thread by construction, so this is a guard, not a real case.

## Migration Plan

No data migration and no backfill. After the daemon is upgraded, a new human-woken turn on a fern-ofm session posts its answer; re-checking the live fern-ofm session needs the upgraded daemon and is the owner's/weaver's step (a worker cannot read another project). The equivalent is covered by an engine test that reproduces the fern-ofm turn shape with a fake runtime: a human `human_message` wake, a long successful turn with a final text and no tool call, and an assertion that the thread gains exactly one outbound answer.
