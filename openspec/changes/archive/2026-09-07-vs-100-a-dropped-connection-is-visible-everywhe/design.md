## Context

Three independent SSE consumers already exist in `packages/ui`, each hand-rolling the same
`BACKOFF = [500, 1000, 2000, 4000, 8000, 15000]` reconnect loop:

- `EventStream` (`api/events.ts`) — a class, one instance per workspace, held in
  `WorkspaceProvider` (`api/context.tsx`) and exposed via `useConnection()`. It already tracks
  `navigator.onLine` / the browser's `online`/`offline` events and reports
  `connecting | connected | reconnecting | offline` (`unreachable` is declared in the type but
  never set by this class — it is a Login-page-only concept driven by a health check, not part of
  this change).
- `useRunEventStream` (`api/runStream.ts`) — a hook, one EventSource per mounted run, used by
  `Chat.tsx`, `RunPage.tsx`, `TicketPage.tsx`. No state exposed at all.
- `useJobStream` (`api/jobStream.ts`) — a hook, one EventSource per mounted job, used by
  `Onboarding.tsx`. No state exposed at all.

All three replay-then-tail with a `?after=<seq>` query param and de-duplicate by id/seq, so
resume-without-duplication (`live-streams/connection-state` — "Reconnecting never loses or
duplicates activity") is already correct in all three and needs no change.

Separately, `Chat.tsx`'s `send()` only queues a thread message when `conn.state` (the *workspace*
stream's state) reads `offline`; a `post.mutate(...)` that fails for any other reason — the
common case when only the daemon's TCP connection drops, which the workspace SSE stream reports
as `reconnecting`, not `offline` — has no `onError`, so the message is dropped and `sending`
(which drives the "working" indicator) is never reset, because the only place that resets it is
the `run.started`/`run.finished` handler on `useWorkspaceEvents`, which never fires for a run that
never started. `Chat.tsx`'s inline `answerDecision` has no offline handling of any kind, unlike
`NeedsYou.tsx`'s `answer`, which already queues a non-secret answer and refuses a secret one.

## Goals / Non-Goals

**Goals:**
- One reconnect/backoff/online-offline implementation, used by all three streams, so
  `live-streams/connection-state` is true of each rather than re-verified per stream.
- `useRunEventStream` and `useJobStream` expose that state and a manual retry to their callers.
- Fix the two silent-drop paths in `Chat.tsx` identified above.

**Non-Goals:**
- Touching `EventStream`'s public shape or `useConnection()` — the workspace stream already meets
  the connection-state contract and nothing consumes it differently after this change. It is
  reasonable to have it adopt the same shared primitive internally, but that is not required to
  satisfy the spec deltas and is left alone to keep the change reviewable.
- Ticket-page comments and plan-revision composers (`TicketPage.tsx`) do not queue on send
  failure today and are not brought in line here — the ticket's acceptance criteria and the spec
  deltas in this change are scoped to the conductor chat and the surfaces (`NeedsYou`) already
  covered by `human-decisions/answer-inputs`. Worth a follow-up ticket, not silently expanded into
  this one.
- The terminal chat (`packages/tui`) is unaffected: this change is `packages/ui` only.
- No daemon or API change.

## Decisions

**A shared hook, not a shared class.** `useRunEventStream` and `useJobStream` are already hooks
tied to component lifecycle (one EventSource per mounted run/job, torn down on unmount or id
change). A new hook, `useLiveStream` in `packages/ui/src/api/sseStream.ts`, factors out exactly
the part that was duplicated — open/close, named-event dispatch, seq-based `?after=` URL,
backoff, online/offline listeners, manual retry — while leaving id-specific concerns (what a
frame means, how it folds into state, the persisted-query merge in `useRunEventStream`) in each
call site. Signature:

```ts
interface LiveStreamOptions {
  url: string | null;              // null => stream closed, e.g. no runId yet
  eventTypes: readonly string[];   // named SSE events to listen for
  onFrame: (raw: MessageEvent<string>) => void;
  resetKey: string | null;         // reopens fresh (seq/backoff reset by the caller) when this changes
}
interface LiveStream {
  status: ConnectionStatus;        // { state, capturedAt, attempts } - same shape as api/events.ts
  retryNow: () => void;
}
function useLiveStream(opts: LiveStreamOptions): LiveStream;
```

The `url` already carries `?after=<seq>` — the caller computes it from its own seq ref before
each open, exactly as today, since only the caller knows how to read a seq out of its frame
shape. `useLiveStream` itself is frame-shape-agnostic: it hands the raw `MessageEvent` to
`onFrame` and otherwise only cares about open/error/close.

`ConnectionState`/`ConnectionStatus` move from `api/events.ts` to `api/sseStream.ts` (the more
fundamental module) and `events.ts` re-exports them, so no import at either existing call site
needs to change name, only source module internally.

**Return shape becomes an object, not a bare value.** `useRunEventStream(runId)` returns
`{ events, status, retryNow }` instead of `RunEvent[]`; `useJobStream(ws, jobId)` returns
`{ job, status, retryNow }` instead of `LiveJob | null`. Both existing call sites that only want
the data (`RunPage.tsx`, `TicketPage.tsx`) destructure `{ events }` and are otherwise unchanged.
Alternative considered: a second hook (`useRunStreamStatus`) reading from a shared ref so the data
hook's signature does not change — rejected, because it either duplicates the EventSource (two
hooks each opening their own connection) or needs a second layer of state sharing between hooks
for one component, which is more machinery than updating three call sites.

**Manual retry resets backoff, not just re-opens.** `retryNow()` sets the internal attempt counter
to 0 before calling `open()`, so a human-triggered retry always tries at once and a subsequent
natural failure starts the backoff ladder over rather than continuing from wherever automatic
retries had climbed to.

**Where the notice renders in Chat.** Inside the existing `working || live` block
(`Chat.tsx` ~line 617), next to the `StatusGlyph`/`working`/`starting…` label — this is "where
the streaming output is" per the spec, and it is inside the scrolling message list, not a fixed
overlay, so it structurally cannot cover the composer or the phone bottom bar (`live-turn-stream`
— "The notice on a phone"). A small presentational component, `StreamStatusNotice`
(`components/StreamStatus.tsx`), takes `{ status, onRetry }` and renders nothing when
`state === 'connected'`, reusing the `working`/`blocked` color tokens `ConnectionBanner` already
uses so the two read as the same kind of notice.

**Fixing the silent-drop paths.** `send()` in `Chat.tsx` gains an `onError` on `post.mutate`: on a
`NetworkError` (the daemon unreachable — see `api/client.ts`), the message is queued through
`enqueue()` exactly as the existing `offline` branch does, and `setSending(false)` runs either
way so the indicator never sticks. `answerDecision()` gains the same offline/secret-aware branch
`NeedsYou.tsx` already has — checked first against `conn.state` before mutating, and against a
failed mutate's `NetworkError` the same way `send()` is. The secret-detection logic (`inputs`
carrying a `type: 'secret'` entry) is lifted out of `NeedsYou.tsx` into a small shared helper
(`lib/decisionSecrets.ts` or similar) rather than copied a second time.

**Job stream in Onboarding.** `Onboarding.tsx` renders `StreamStatusNotice` next to the job's own
step/log display, using the same component as Chat.

## Risks / Trade-offs

- [Changing two hooks' return shape touches three call sites (`Chat.tsx`, `RunPage.tsx`,
  `TicketPage.tsx`) and one for the job stream (`Onboarding.tsx`)] → each is a one-line
  destructure change; `pnpm typecheck` catches any missed one immediately since the old bare
  return type disappears.
- [`useLiveStream`'s generic `onFrame` signature could tempt future callers to skip seq tracking]
  → keep the JSDoc on `useLiveStream` explicit that seq/dedup is the caller's job, matching how
  `runStream.test.tsx` already tests it directly against `FakeEventSource`.
- [Extracting the secret-detection check into a shared helper touches `NeedsYou.tsx`, which is
  otherwise unrelated to this ticket] → it is a pure function extraction with no behavior change
  there; `NeedsYou`'s existing tests, if any, act as the regression guard.

## Open Questions

None — the scope decisions above (terminal chat, ticket-page composers, `EventStream`'s internal
implementation) are deliberate exclusions, not deferred unknowns.
