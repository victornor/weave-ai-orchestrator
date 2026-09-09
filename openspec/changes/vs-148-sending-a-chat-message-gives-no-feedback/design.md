## Context

See `proposal.md` for the motivation. Relevant current state, found while investigating:

- `Composer` (`packages/ui/src/components/Composer.tsx`) is the one composer behind conductor chat,
  ticket comments, decision notes, revise-plan notes and worker steer messages. Its `send()` already
  branches on whether files are attached: the files branch awaits `onSubmit` and only clears on
  success (`.catch(() => {/* kept for retry */})`); the no-files branch calls `onSubmit` and clears
  synchronously, regardless of outcome. Neither branch disables anything while `onSubmit` is pending —
  the send button's only `disabled` condition today is `!text.trim() || disabled`, and the caller
  (`Chat.tsx`) never passes `disabled` at all.
- `Chat.tsx`'s `send()` returns a promise for the attachment path (`post.mutateAsync(...)`) but calls
  `post.mutate(...)` — fire-and-forget — for the plain-text path, and unconditionally clears
  `replyToId`/`projectId` right after calling it, whether or not the request will succeed.
- `POST /threads/:id/messages` (`packages/server/src/routes/threads.ts`,
  `packages/core/src/threads/service.ts` `inbound()`) has no deduplication of any kind: two requests
  with identical content produce two `thread_messages` rows and two `wake.enqueue` calls. This confirms
  the ticket's suspicion — a duplicate that reaches the daemon is fully acted on, not just rendered
  twice.
- Attachments already travel as one `multipart/form-data` request with the text (VS-133); the server
  does no re-encoding. The client's `fetch`-based request wrapper (`packages/ui/src/api/client.ts`)
  exposes no upload-progress event, so "uploading" and "sending" are not two observable phases over
  this transport — there is one request, one settle.
- `wake.enqueue` already has a per-agent idempotency key (`packages/core/src/wake/index.ts`) for
  daemon-internal callers. This proposal adds a comparable, client-generated key one layer up, at the
  message itself, which is the layer that decides whether a *thread_messages row* — not just a wake —
  gets duplicated.

## Goals / Non-Goals

**Goals:**
- Make a send that is still in flight impossible to trigger twice from the same composer instance.
- Make a duplicate that a client sends anyway (after a lost response, most plausibly) a no-op on the
  server, not a second accepted message.
- Never lose a human's typed message or attachment because a send failed.

**Non-Goals:**
- Cross-tab or cross-device deduplication of two independently-composed messages that happen to have
  the same text. The idempotency key is generated once per compose attempt and is not derived from the
  message content, so two genuinely separate messages with identical text are never conflated.
- A real upload-progress percentage. Not achievable without moving off `fetch` for this one request
  type (for example to `XMLHttpRequest` for its `upload.onprogress`, or a chunked/streamed upload
  protocol) — out of scope; flagged for a future ticket if the human wants a true progress bar.
- Extending the in-flight lock to every `Composer` caller's own retry/backoff semantics — the change
  only guarantees `Composer` treats its `onSubmit` promise correctly. A caller that itself queues or
  retries beyond the promise it returns (none currently do) would need its own review.

## Decisions

**The in-flight lock and clear-on-settle live in `Composer`, not in each caller.**
`Composer` already tracks `files`/`text` state and is the one place that knows "a send was just
triggered." Duplicating a lock into every one of the seven call sites would drift the way the
attachment-only clear-on-failure logic already had before this change (it existed for files, not for
plain text). Alternative considered: push the lock into each route's mutation hook
(`usePostThreadMessage`, etc.) via TanStack Query's own `isPending`. Rejected — that would need every
caller to plumb its own mutation's pending state into its `Composer` via `disabled`, which is exactly
the drift this avoids, and several callers (`DecisionCard`'s revise/free-text notes) call `onAnswer`
synchronously with no mutation object in scope at all.

**`onSubmit`'s contract becomes: return a promise that settles when the attempt is fully decided.**
A caller that returns `void` (a few call sites do, e.g. `DecisionCard`'s `onSubmit={(t) => { onAnswer(...); }}`)
is treated as already-settled the instant it's called — `Promise.resolve(undefined)` resolves on the
next microtask, so the lock is held for one tick and the behavior is indistinguishable from today. This
is why the change is safe to land as a `Composer`-wide fix rather than something scoped with a new prop
flag: every existing caller keeps its current behavior unless it already returns (or is changed to
return) a promise tracking the real request.

**Chat's plain-text `send()` switches from `post.mutate` to `post.mutateAsync` and returns that
promise; the reply/project-pick reset moves from immediately-after-call to the `.then()`.**
Mirrors the attachment path, which already does this. The `offline` branches (queue-and-return,
reject-for-attachments) are unaffected: queuing is synchronous and is correctly treated as "settled" at
once — there is no network wait to lock against.

**Visible progress is a status line inside `Composer`, not a percentage.**
Given fetch exposes no upload progress (see Context), a spinner and "Sending…" / "Uploading and
sending…" text is the honest representation: it says a request is outstanding without implying
measured progress that does not exist. Copy differs only on whether `files.length > 0`, decided at the
moment `send()` is called (the set of files does not change mid-flight, since the control is locked).

**Idempotency key: client-generated per compose attempt, kept stable across a retry of unchanged
content, sent as a body/form field alongside `body`.**
Generated with `crypto.randomUUID()` when `Composer.send()` is first called for a given piece of typed
content; a ref remembers `{ key, text, fileNames }` from the last *failed* attempt. The next call to
`send()` reuses that key only if `text` and the attached files are unchanged from what was attempted;
otherwise a new key is generated. This is what distinguishes "the human retried the same message" from
"the human sent a new message that happens to follow a failed one." Alternatives considered:
- *Server-generated key, returned to the client for the client to echo on retry.* Rejected: the whole
  problem is a *lost response*, so the client may never receive the key to echo back.
- *Content hash instead of a random key.* Rejected: two genuinely different messages that happen to
  have identical text (a human resending the same phrase in a new context) would be indistinguishable
  from a retry. A client-chosen key scoped to one compose attempt has no such collision.
- *Dedupe window based on time and content, no explicit key.* Rejected: fragile (what window is
  correct?) and does not solve the case this exists for as directly as an explicit key.

**Server-side dedup is a plain `SELECT` inside the same transaction as the insert, not an
insert-and-catch-unique-violation.** `thread_messages` gains a nullable `idempotency_key` column with a
partial unique index (`WHERE idempotency_key IS NOT NULL`), scoped to `thread_id`. `inbound()` already
runs inside `tx(db, () => {...})`; before calling `insertMessage`, it checks for an existing row with
the same `(thread_id, idempotency_key)` and returns that message unchanged — no new row, no
`ctx.events.emit`, no `wake.enqueue` — if found. `node:sqlite` in this codebase is synchronous and
single-connection per workspace, so there is no concurrent-writer race between the check and the
insert; the unique index exists as a correctness backstop (and the thing that makes the check
meaningful at all), not as the mechanism relied on for detecting the conflict.

**The key travels as a normal field, not a header.** The multipart path already puts everything but the
files into form fields (`body`, `projectId`, `replyToMessageId`); adding `idempotencyKey` there is
consistent. The JSON path gets the same field name in its body schema. An `Idempotency-Key` header was
considered and rejected only for consistency — this codebase has no existing header-based idempotency
convention to follow, and a body field keeps both request shapes symmetric.

## Risks / Trade-offs

- [A human opens the same draft in two tabs and sends from both within the lock window] → Each tab
  generates its own key (per-composer-instance, not per-draft-storage), so both sends are accepted as
  two distinct messages — correct, since two tabs sending is not the "one tap fired twice" case this
  protects against, and drafts are not synchronized across tabs today regardless (`composer-drafts`
  spec: "SHALL NOT be carried to another device").
- [The idempotency key column adds a small amount of write-path complexity to a hot path] → Mitigated
  by keeping the check a single indexed `SELECT` before the existing insert; no change to the
  transaction's success path when no key collision exists.
- [A caller other than conductor chat could start sending an idempotency key without meaning to] →
  Only `Chat.tsx`'s `send()` is changed to generate and send one; the field is optional and ignored (no
  behavior change) for every other `Composer` caller, none of which are touched by this change.

## Migration Plan

- New migration `0020_thread_message_idempotency_key.sql`: adds the nullable column and the partial
  unique index. Existing rows get `NULL`, which the unique index ignores, so no backfill is needed and
  the migration is additive-only (no rollback script needed beyond the project's standard forward-only
  migration convention — confirm this matches `packages/db`'s existing migrations, none of which appear
  to ship a paired "down" file).
- No data migration for existing `thread_messages` rows; they simply have no idempotency key and behave
  exactly as before.
