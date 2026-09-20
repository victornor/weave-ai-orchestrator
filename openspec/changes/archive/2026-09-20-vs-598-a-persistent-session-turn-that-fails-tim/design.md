## Context

See `proposal.md` — Why. VS-596 is on `main` (`c4e60853`) and already posts both a session turn's answer and its failure notices. Its merged form:

- `deliverSessionAnswer` (engine.ts) handles every terminal status, not only success, and posts `sessionOutcomeNotice` for `timed_out`, `cancelled`, `interrupted` and `failed`.
- `sessionOutcomeNotice` stays silent when `scheduled_retry_at` is set, on `interrupted_by_shutdown`/`interrupted_by_message`, and on `errorFamily === 'auth'`; otherwise it names the plain reason.
- `plainFailureReason` renders the family's words ("the usage limit was reached", "the model provider kept failing", …).
- The engine's own retry wake carries `threadId`/`messageIds` forward (engine.ts, the `RETRYABLE` branch), so an engine-scheduled retry resumes with context.
- `sessionReplyContext` derives the thread and quoted messages from the `human_message` wake, then `deliverSessionAnswer` returns if there is no thread.

The one path with no context is the **watchdog's** retry: `supervisor/index.ts` enqueues `{ source: 'retry', payload: { retryOfRunId } }` after a silence or hard-timeout cut, with no `threadId`. That resume posts nothing today. A ticketless session's conversation is exactly one workspace-owned `channel_threads` row (`threads.createOwned` in `workers.ensureSession`, which throws if it is missing), so the thread is reachable from the session alone: `threads.list({ agentId })[0]`.

Remaining wording gaps: `plainFailureReason` gives no reset time and no "nothing retries automatically"; `sessionOutcomeNotice` returns null for `auth`, so an expired login is silent.

Run endings (`finalize`, engine.ts): `interrupted` is the daemon's resume signal (`interrupted_by_shutdown`, `interrupted_by_message`, watchdog `interrupted`); a usage limit is a `failed` run with `errorFamily: 'provider_quota'` and raises no card for a session; an expired login is `failed` with `errorFamily: 'auth'` and preserves the wake (so the turn resumes once the runtime is healthy) unless three in a row on one worker exhaust the ladder, in which case `parkForHuman` parks the agent and raises a card.

## Goals / Non-Goals

**Goals:**

- A session turn that the daemon stopped and later resumes reports its real outcome, even when the retry wake carries no thread context.
- A usage-limit notice gives the reset instant and the human's next step; an expired login is stated with what happens next.
- Keep VS-596's working, tested delivery; change no existing behaviour except the wording and the watchdog gap.

**Non-Goals:**

- Replacing VS-596's wake-based delivery with a thread-triggered one (the earlier plan revision; dropped on the weaver's decision).
- Backfilling past runs; giving a session a usage-limit retry card; changing `parkForHuman`.
- Changing the worker, weaver or planner paths, or the UI rendering.

## Decisions

### D1. The fallback lives in `sessionReplyContext`, and applies only to a retry

`sessionReplyContext` gains an optional `{ agentId, deps }`. When the wake yields no thread — and only when the flattened wakes include a `retry` source — it resolves `deps().threads.list({ agentId })[0]` and the human messages that thread still owes an answer (`threads.messages(threadId, { limit })`). It returns that thread and those message ids only when there are such messages; otherwise it returns no thread, so nothing is delivered. The retry gate is what separates a resumed turn from any unrelated turn: a self-scheduled wake never triggers the fallback, so it cannot answer a stale message.

**"Still owes an answer" is measured against the last agent-authored outbound message, not the newest message.** A `system` notice is not an answer, and the cut run posts one itself (D2). If pending were "the thread ends inbound", the cut's own "interrupted" notice would be the newest message and the retry-woken resume would find nothing to answer — the exact end-to-end hole this fix closes. So `pendingHumanMessages` scans for the last message with `direction === 'outbound' && authorKind === 'agent'` and returns the inbound messages after it, oldest-first. A tool-posted agent reply still counts as the answer, so a turn that already answered is not re-answered.

Rejected alternative: keep "newest message is inbound" and suppress the cut notice so the thread still ends inbound. It couples the definition to a notice whose presence is not reliably knowable at delivery time (D2).

Rejected alternative: fall back for any wake with no thread. It would let a self-scheduled turn answer whatever human message happens to be newest, which the conductor's test forbids.

Rejected alternative (earlier revision): the full thread-triggered delivery. The weaver chose not to replace VS-596's working, tested path; the fallback achieves the same fix for the one broken path with far less surface.

### D2. The fallback is gated to sessions at the call sites

`sessionReplyContext` is also called in `finalize`'s retry-carry, once per retried turn whatever the agent kind. The call sites pass `{ agentId, deps }` only for a `session` (the delivery step is already session-only, and `finalize` checks `f.agent.kind === 'session'`), so a worker's retry never touches the threads service.

### D2b. The cut run still posts its own notice; the resume answers past it

The supervisor enqueues its retry wake in a later watchdog tick, at least `KILL_AFTER_INTERRUPT_MS` (30 s) after the cut, and only if the runtime has not already exited; nothing at the cut's delivery time says reliably whether a resume is coming. So the cut turn keeps its existing behaviour — an `interrupted` cut posts its "was interrupted" notice, a `timed_out` cut its "took too long" notice — and D1's definition of pending makes the retry-woken resume deliver past it. The human may therefore see one short notice followed by the answer; that is preferred over a silent gap, and it is the conductor's option (2) resolved as "keep the notice, rely on (1)".

Rejected alternative: guess "the supervisor will resume this" from the run's state. There is no such flag on the run at delivery time; the retry wake does not exist yet.

### D3. Delivery semantics are unchanged; only the watchdog path is filled in

The retry gate means the fallback fires on exactly the resume the watchdog creates. The engine-scheduled retry still carries its own context and stays silent while pending (`scheduled_retry_at` set). `interrupted` still posts for a plain interrupt and stays silent for shutdown/message resumes. Nothing existing is removed.

### D4. Usage-limit wording

`sessionOutcomeNotice` branches `failed` + `provider_quota` to `quotaNotice(errorText)`: name the limit, add ` It resets at <fmtUtc(parseResetTime(message))> UTC.` when a reset parses, and close with "Nothing retries automatically — send another message to try again." `parseResetTime` and `fmtUtc` already exist in engine.ts. The old quota line in `plainFailureReason` is removed as unreachable.

### D5. Expired-login wording, and truthfulness about what happens next

The `auth` early-return is replaced by a branch that says a new login is needed and then states the truth from the run's preserved wake: when the turn's wakes are still `queued` after `finalize` (the auth ladder preserved them, so the runtime will be ungated and the turn resumes), the notice says the conversation resumes once the login is renewed; when they are not (the ladder is exhausted and `parkForHuman` parked the agent on a card), it says to log in and retry. `resumesPending` is computed from `input.wakes`' current statuses, which `finalize` has already settled before delivery runs.

### D6. The UI needs no change

VS-596 renders every `system`-authored message as the notice; the new wording rides the same path. Evidence is produced, not new rendering.

### D7. The spec modifies VS-596's two requirements

The behaviour changes belong to the requirements VS-596 introduces, so the delta is a `MODIFIED` rewrite of both, copying every existing scenario verbatim and adding the new ones (the archive replaces the whole block, and dropping a scenario is refused). The change's two requirements are in the base spec now that VS-596 has landed.

## Risks / Trade-offs

- **The fallback could answer a stale message** → gated to a `retry` wake and to a thread that still owes an answer after its last agent-authored outbound message; a self-scheduled turn posts nothing (test).
- **The cut's notice precedes the resumed answer** → accepted and documented in D2b; the alternative (guessing at delivery time whether a resume is coming) is not reliably knowable.
- **A transient failure the daemon retries stays silent until it resolves** → VS-596's existing rule and deliberate; the notice fires once the retries are exhausted or the family is not retried.
- **`resumesPending` misreads the preserved-wake state** → it reads the run's own wakes after `finalize`, which is exactly where the auth ladder records "preserve" versus "park"; both branches are honest (test covers the preserved case; the parked case falls to the "log in and retry" wording).
- **A provider message in the notice is long** → `plainFailureReason` already truncates to 240 chars, single line; the quota notice uses fixed wording plus a parsed timestamp.

## Migration Plan

No data migration, no backfill. After the daemon is upgraded, the next daemon-stopped-and-resumed session turn reports its outcome, and the next usage-limit or expired-login ending says the human's next step. Past sessions are unchanged.

## Open Questions

None. Whether a session's usage-limit ending should also raise a human retry card (rather than only tell the thread) remains a separate product decision, noted so it is not lost.