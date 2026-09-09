## Why

Captain sent a screenshot on a flaky connection: the send button stayed live for ~15 seconds with no
sign anything was happening, so they tapped it again, worried the first tap had missed. Two problems
are conflated in that report: the composer gives no feedback while a send is in flight, and — the one
that matters — the send control is never disabled, so a repeated tap can genuinely fire a second
`POST /threads/:id/messages`. That request is not free: it wakes the conductor and can produce a
duplicate ticket. Investigation below shows the daemon has no deduplication on this route today, so a
second request that reaches it is fully acted on, not just displayed twice.

## What Changes

- `Composer` (the one component behind conductor chat, ticket comments, decision notes and revise-plan
  notes) tracks its own submit-in-flight state: the send control is disabled from the moment `onSubmit`
  is called until its returned promise settles, Enter-to-send is guarded the same way, and the composer
  shows a visible "Sending…" (or "Uploading and sending…" when attachments are present) status instead
  of looking idle.
- The composer's text and attachments are cleared only once `onSubmit` resolves. A rejection leaves
  both in place for a retry — extending a guarantee that today only covers the attachment path
  (`message-attachments` spec) to a plain-text send too, which currently loses the typed message on any
  failure.
- The conductor chat's own `send()` (`Chat.tsx`) is changed to always return a promise that settles
  with the request, for both the plain-text and the attachment path, so the composer's lock reflects
  the request's real duration rather than an instantly-resolved fire-and-forget call.
- `POST /threads/:id/messages` (JSON and multipart) accepts an optional client-generated idempotency
  key. The conductor chat composer sends one, kept stable across a retry of unmodified content and
  regenerated when the human edits the message before retrying. On the server, a second request
  carrying a key already stored on that thread returns the existing message instead of creating another
  one — this is the "duplicate can still reach the daemon" gap a client-side lock alone cannot close,
  because a human who sees a failed send (for example, a lost response after the request actually
  succeeded) will legitimately retry with the same content.
- Investigated "why fifteen seconds": attachments already travel as a single `multipart/form-data`
  request (VS-133), with no base64 inflation and no server-side re-encoding or recompression. The
  client uses `fetch`, which exposes no upload-progress events, so the delay cannot be shown as a
  percentage or split into an "uploading" phase distinct from "sending" — both happen inside one
  unobservable request. The composer's new status line is worded to reflect that (a blended
  "Uploading and sending…", not a progress bar). No inflation bug was found; the delay is consistent
  with a slow connection carrying a real multi-megabyte request in one shot.

## Capabilities

### New Capabilities
- `conductor-chat/composer-send-lifecycle`: what a composer does between triggering a send and the
  request settling — locking the send control, showing visible progress, retaining contents on
  failure, and the idempotency key that stops a retried request from being accepted twice.

### Modified Capabilities
- `conductor-chat/message-attachments`: removes "a failed attachment upload leaves the composer's text
  intact" — generalized and superseded by the new capability's "a message is not lost when its send
  fails", which covers a plain-text send too.
- `conductor-chat/composer-drafts`: "sending clears the draft" now means "a *confirmed* send clears the
  draft" — a failed send keeps the draft (and the reply reference / project pick that travels with it)
  exactly as it was, rather than clearing on the attempt.

## Impact

- `packages/ui/src/components/Composer.tsx` — in-flight lock, status line, clear-on-settle for both
  branches.
- `packages/ui/src/routes/Chat.tsx` — `send()` returns a promise on every path; idempotency key
  generation and reuse-on-retry; reply/project-pick cleared only on confirmed send.
- `packages/server/src/routes/threads.ts` — accepts `idempotencyKey` on both request shapes.
- `packages/core/src/threads/service.ts` — `inbound()` short-circuits to the existing message when the
  key has already been stored for this thread.
- `packages/db` — new nullable `idempotency_key` column on `thread_messages`, unique per thread where
  set.
- Every other `Composer` caller (ticket comments, decision notes, revise-plan notes, worker steer
  messages) inherits the in-flight lock and clear-on-settle behavior for free, since they share the
  component; none of them send attachments today, and none regress, since a void-returning `onSubmit`
  is treated as already-settled exactly as before.
