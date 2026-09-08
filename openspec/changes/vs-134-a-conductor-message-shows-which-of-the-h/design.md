## Context

See proposal.md - Why. Relevant existing shape:

- `ThreadMessage.replyToMessageId`/`replyToExcerpt` already exist (`packages/shared/src/types.ts:90`).
- `threads.inbound()` (`packages/core/src/threads/service.ts`) already validates a reply target scoped
  to the thread via `repliedToMessage(threadId, messageId)`, deriving `replyToExcerpt` with `excerpt()`
  (bounded to `REPLY_EXCERPT_CHARS`), and throws `OcError('not_found', ...)` for a missing or cross-thread
  target. `threads.outbound()` exists but its declared type (`packages/core/src/api.ts:401`) only takes
  `{ parts, runId }` — it does not expose `replyToMessageId` at all, so nothing today can set one.
- `ac_human_send` (`packages/server/src/tools.ts`) is the only path an outbound conductor message takes.
  It already resolves an implicit thread via `originThreadId(ctx)`, which scans `bundledWakes(ctx)` —
  the wakes attached to this run (`packages/server/src/tools.ts:102`, `bundledWakes`).
- A `human_message` wake's payload already carries `messageId` (`packages/core/src/threads/service.ts`,
  the `wake.enqueue` call inside `inbound()`), so the turn that answers a message can find that message's
  id without a new field anywhere.

## Goals / Non-Goals

**Goals:**
- One validation/excerpt path for a reply reference, used by both directions.
- A clear, discoverable way for the conductor to opt out of the default in the same turn it applies.

**Non-Goals:**
- Changing how a reply target reaches the *human* side (`threads.inbound`, the web composer) — unchanged.
- Any new UI. The renderer is untouched; see proposal.md - Impact.
- Deduplicating or rate-limiting repeated defaults within a turn (e.g. two `ac_human_send` calls in the
  same turn, neither specifying a target, both defaulting to the same woke message) — allowed, not
  special-cased.

## Decisions

### Where validation lives: `threads.outbound()`, not the tool handler

`insertMessage()` already accepts `replyToMessageId`/`replyToExcerpt` as raw opts with no validation —
today nothing reaches it because `outbound()`'s public type omits the field. Moving validation into
`outbound()` (mirroring `inbound()`'s `repliedToMessage()` + `excerpt()` calls) rather than into the tool
handler keeps the single point of truth for "what is a valid reply target" inside the threads service,
where `inbound()` already enforces the same rule. The tool handler only decides *what id to pass*, never
whether it is valid.

`ThreadsService.outbound()`'s opts type gains `replyToMessageId?: string | null`.

### Default resolution: computed in the tool handler, from this run's bundled wakes

`ac_human_send`'s handler gets a new helper, `defaultReplyToMessageId(ctx)`, next to the existing
`originThreadId(ctx)` — same source (`bundledWakes(ctx)`), so it reads the wakes that are actually part
of this turn rather than the agent's whole queue. Several human messages arriving before a turn is
dispatched coalesce into one `queued` wake (`wake.enqueue`'s Gate 3), with the later ones folded into
that wake's `payload.bundle` rather than becoming separate rows — so counting raw wake rows would
undercount them and wrongly default when two messages actually woke the turn. The helper runs
`bundledWakes(ctx)` through the already-exported `flattenWakes` (the same unpacking `buildTurnPrompt`
uses for "why you were woken") before filtering to `source === 'human_message'`; if exactly one remains,
it returns that entry's `payload.messageId`, else `null`.

This lives in `packages/server`, not `packages/core`, because "what woke this turn" is a run-token/tool
concept (`ToolCtx.claims.runId`) that `threads.outbound()` has no reason to know about — `outbound()`
takes an explicit id or none, exactly like `inbound()` does today.

**Alternative considered**: default inside `threads.outbound()` itself, given a `runId`. Rejected: it
would make the threads service reach into the wake service for a decision that has nothing to do with
threads, and every other caller of `outbound()` (e.g. `notifyHuman`'s internal call) would need to reason
about whether a default applies to them too.

### Distinguishing "no target given" from "explicitly no target"

`ac_human_send`'s `replyToMessageId` input is `z.string().nullable().optional()`:
- absent (`undefined`) → the default applies (single-wake case) or resolves to `null` (not exactly one).
- `null` → explicit opt-out; the default never applies, regardless of the turn's wakes.
- a string → explicit target; validated by `threads.outbound()` exactly as an inbound reply is.

This is the "clear way to send an unrelated message... without a quote" the ticket asks for: the
conductor passes `replyToMessageId: null`. The tool description states this plainly, since it is the only
place that reaches the conductor.

### Rendering: no change

`ChatMessage` in `packages/ui/src/routes/Chat.tsx` already renders `message.replyToExcerpt` regardless of
`message.direction`. Acceptance criterion 2 is met by construction once the data is populated; no
component change is needed or made.

## Risks / Trade-offs

- **A turn that answers a message but calls `ac_human_send` more than once, all without an explicit
  target, defaults every one of them to the same quote.** Accepted: the alternative (only the first call
  gets the default) requires per-turn mutable state the tool layer does not otherwise keep, and the ticket
  does not ask for it. The conductor has the explicit opt-out for any call after the first that is not
  actually answering the wake.
- **`bundledWakes(ctx)` falls back to the agent's whole claimed/queued list when the run's `wakeupIds`
  cannot be read** (see its doc comment). In that fallback, "exactly one human message" reflects the
  agent's queue rather than strictly this run's wakes — the same imprecision `originThreadId` already
  accepts for thread resolution, so this does not lower the bar `ac_human_send` already operates under.

## Migration Plan

Additive: new optional input field, new optional service opt, no schema/DB migration (the columns already
exist). No rollback concerns beyond a normal revert.
