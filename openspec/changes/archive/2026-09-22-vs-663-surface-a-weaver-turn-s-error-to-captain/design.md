## Context

See `proposal.md` — Why. This section records the current behaviour the ticket asked to find, then the constraints that shape the approach.

### What happens today when the weaver's turn fails

Investigated against `packages/core/src/runs/engine.ts`, `packages/runtime-sdk/src/process.ts`, `packages/agent/src/errors.ts` and the adapters. Findings, all file:line:

- **Classification.** A failure becomes one of `transient_upstream | provider_quota | model_refusal | auth | tooling | resource | unknown` (`packages/shared/src/enums.ts`). The CLI adapters map a runtime's stderr/`is_error` through `classifyError` (`packages/runtime-sdk/src/process.ts:137`). Its transient pattern matches `502|503|504` but **not `500`**, so an HTTP 500 from the model provider falls through to `exit_<N>`/`unknown`, or to the adapter's fallback `runtime_error`/`unknown` when the CLI exits 0 with `is_error` set (`packages/runtimes/claude/src/adapter.ts:239`). The built-in `weave` runtime's own classifier maps `>= 500` to `upstream_error`/`transient_upstream` (`packages/agent/src/errors.ts:92`), so the two runtimes behave differently for the same provider failure.
- **Retries.** Only `['transient_upstream', 'resource']` are retried (`engine.ts:70`), three attempts at 30 s / 2 m / 10 m (`engine.ts:49`). Each retry is a fresh wake carrying `retryOfRunId`, and the run row gets `scheduled_retry_at` (`engine.ts:1225`). Attempts are counted by walking the `retry_of_run_id` chain (`engine.ts:1376`). `auth` gets one retry after re-seeding the credential; `provider_quota` is not retried; `unknown` is not retried at all.
- **Recorded.** `runs.status='failed'`, `error_code`, `error_family`, `last_error` (from the `error` run event, `engine.ts:371`); the agent becomes `active` while a retryable failure is retrying (`engine.ts:1150`), else `error`.
- **Surfaced today.** The `error` run event and `run.finalized` render in the run-detail transcript, not the chat. A failed turn posts a chat system notice only for a **ticketless persistent session** (`deliverSessionAnswer`, gated `agent.kind !== 'session' || input.ticket`, `engine.ts:899,936`). A **worker** failure blocks its ticket and raises a `retry_approval` card (`engine.ts:1240`). The **weaver** gets neither on an `unknown` failure: the worker-only branch excludes it, no card is raised, and `deliverSessionAnswer` skips it — the silent gap captain saw. On a `transient_upstream` failure the weaver retries up to three times and then `parkForHuman` raises a card, but across the retries the chat shows nothing.

This confirms the ticket's premise: the gap is the weaver's, and it is worst for the `unknown` class a bare provider 500 produces.

### Constraints

- The weaver's only route to the human is its own `weave_human_send` tool (`packages/server/src/tools.ts:1078`), a call a turn that dies at the adapter never makes. Nothing else writes to the weaver thread today.
- The weaver has a conversation thread: a primary `channel_threads` row owned by the weaver agent (`packages/core/src/threads/service.ts:253,588`). The chat reads it through `GET /threads/:id/messages`.
- The persistent-session spec already states the exact semantics we need for a failure notice, and its implementation (`sessionOutcomeNotice`, `engine.ts:947`) is the wording to mirror.
- Repo rules forbid launching the real coding CLI from a ticket, so a live adapter 500 cannot be reproduced here; verification uses the fake runtime adapter and the UI harness (see Risks).

## Goals / Non-Goals

**Goals:**
- A terminal failure of a weaver turn is legible in the weaver's own chat as one system notice.
- A retry in flight is visible without a message per attempt.
- Both hold across a reload, and none of it disturbs sessions, workers or the planner.

**Non-Goals:**
- Changing retry counts, backoff, adapter selection or error classification. The `500` finding above is reported, not fixed here (see Risks).
- Adding failure notices to the worker or persistent-session surfaces; those already exist.
- A new route, table or column — the retry column already exists.

## Decisions

### D1: Post the notice from the engine's finalize-time delivery, gated to the weaver

Add a conductor sibling to `deliverSessionAnswer` — e.g. `deliverConductorTurnNotice` — called beside it from `executeRun` (`engine.ts:791`). Gate it on `agent.kind === 'weaver'`, reuse `sessionOutcomeNotice`/`plainFailureReason`/`quotaNotice` for wording (the spec's plain-reason and next-step rules are the ones we want), and post with `deps().threads.outbound({ kind:'system', id:null }, threadId, notice, { runId })`.

*Why a sibling rather than widening `deliverSessionAnswer`:* the session path resolves its target and reply quote through `sessionReplyContext`, which is session-shaped; mixing the weaver in risks the VS-620/VS-598 resume logic. A sibling keeps the session path byte-for-byte unchanged and is independently testable.

*Target thread:* prefer the waking wake's `threadId` when the wake named one and the thread is owned by the weaver (the human-message case); otherwise `threads.primaryThread()` (a weaver turn woken by a decision or the supervisor). Verify `thread.agentId === agent.id` before posting, the same guard `deliverSessionAnswer` uses.

*Suppression.* Reuse the session rules: no notice while `scheduled_retry_at` is set, for `interrupted_by_shutdown` / `interrupted_by_message`, or when `hasOutboundForRun(threadId, runId)` (the turn already replied via `weave_human_send`, which stamps `runId`). `auth` is already announced to the chat by the auth gate (`packages/core/src/runs/authgate.ts:156`); the sibling still follows `sessionOutcomeNotice`'s auth wording, which the existing dedupe (`hasOutboundForRun` is per-run, not per-outage) does not cover. To avoid a second auth message, the sibling skips `errorFamily === 'auth'` — the gate owns that case.

*Alternatives considered:* (a) a universal notice path for every agent kind — rejected: it would duplicate the worker ticket card and the session notice; (b) a client-only notice derived from the run row — rejected for the terminal case because it would not be a durable conversation record and could differ between clients.

### D2: Retry visibility is a run field plus a non-persisted chat state

The retry's due instant already lives on `runs.scheduled_retry_at`; expose it as `Run.scheduledRetryAt` (`packages/shared/src/types.ts`, the row mapper already camel-cases the column). The weaver chat derives a "retrying" state from its latest run when that run is a failure with a future `scheduledRetryAt`, and renders it as a transient notice — the same plain-reason wording family, but not written to `thread_messages`. It clears when a later attempt runs (`run.started`) or the instant passes.

*Why not a persisted message:* the ticket asks for no per-attempt spam and for a first-retry blip to be quiet. The persistent-session spec already establishes "a turn that will be retried SHALL NOT be announced until its final outcome"; persisting a retrying message would contradict that and leave stale text after a blip. A field-derived state survives a reload without becoming conversation history.

*Alternative considered:* a new ephemeral `run.retrying` event frame. Rejected — a new event type and coalescing plumbing for one boolean, when the due instant is already stored and readable.

### D3: The weaver chat renders `system` messages as notices

`ChatMessage` is direction-only today (`mine = direction === 'inbound'`), so an outbound system notice would render as a weaver bubble. Add an early branch: `authorKind === 'system'` renders centred, muted, labelled `System` — lifting the shape `SessionThreadFeed` already uses (`packages/ui/src/v2/WorkerPage.tsx:152`). The planner chat shares the component and gains the same rendering harmlessly.

The retrying state (D2) renders as a sibling of the existing live/working region in `V2ChatPage`/`ChatConversation`, via an optional prop so plan tabs are unaffected. Exact placement is an apply-time detail; it must not push the composer on phone layouts.

## Risks / Trade-offs

- **A bare provider `500` is not retried at all** (`unknown`), so on the Claude adapter the human will usually see the terminal notice rather than a retrying state. This is a finding for the ticket owner, not a defect introduced here: the ticket scopes this change to visibility and forbids touching classification unless that *is* the bug. → Report it plainly in the PR and the plan; propose a follow-up if captain wants `500` treated as `transient_upstream` for the CLI adapters.
- **Duplicate auth messaging.** `deliverSessionAnswer` includes auth wording and the auth gate also posts. → The conductor sibling skips `auth`; the gate remains the single auth announcement.
- **A stale retrying state.** A failed run keeps `scheduled_retry_at`; if the retry never runs, the state could linger. → Only show it while the instant is still in the future; it self-clears, and the dispatcher picks retries up within a second of `notBefore`.
- **Notice into the wrong thread.** A weaver turn can be woken by a system wake. → Prefer the waking thread, else the primary human thread, always checking ownership.
- **No live 500 reproduced.** Repo rule forbids running the real CLI from a ticket. → Engine tests drive a fake runtime that emits a typed adapter error; the UI states are exercised through the screenshot harness with mocked fetch. The PR will say the real-adapter 500 path is unverified live and needs the owner to confirm on a running daemon.

## Migration Plan

No migration: no schema, route or config change. `Run.scheduledRetryAt` is a projection of an existing column. Rollback is a revert of the code changes; notices already posted remain as normal thread messages.

## Open Questions

- Should the CLI adapters' `classifyError` treat `500` as `transient_upstream` (making the weaver auto-retry provider 500s)? Out of scope here; a follow-up ticket if captain wants it.
