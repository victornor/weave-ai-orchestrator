## Context

See `proposal.md` — Why. The parts of the existing system this design leans on, all verified in the tree:

- An inbound human message is one row and one wake. `ThreadsService.inbound` inserts a `thread_messages` row and, for an unbound thread, enqueues a `human_message` wake with `payload: { threadId, messageId, body }` (`packages/core/src/threads/service.ts:115`–`:133`). A thread bound to a ticket takes the other branch and becomes a ticket comment instead (`:123`).
- `ac_inbox` returns each wake's `payload` verbatim (`packages/server/src/tools.ts:141`). Anything added to the payload reaches the conductor with no change to the tool.
- The wake payload vocabulary already has this exact pair: the project-added scout ticket is routed with `payload: { kind: 'project_added', projectId: project.id, projectSlug: project.slug }` (`packages/core/src/projects/index.ts:138`).
- `ProjectsService.get` resolves a project by id **or** slug, scoped to the workspace, and throws `not_found` otherwise (`packages/core/src/projects/index.ts:21`–`:25`). It is the whole validation this change needs, and it is already reachable from the threads service through `deps()`.
- `Db.camel` maps `snake_case` columns to camelCase and `messages()` selects `*` (`packages/db/src/db.ts:79`, `packages/core/src/threads/service.ts:168`), so a new `project_id` column reaches the API response as `projectId` with no query change.
- Removing a project is a soft archive — the row stays with `status = 'archived'` (`packages/core/src/projects/index.ts:169`). No project row is ever deleted, so a foreign key from a message to a project can never dangle.
- `ChatRoute` already calls `useProjects()` and `useThreadMessages()`, and posts through `usePostThreadMessage` or, when offline, through `enqueue({ kind: 'thread', path, body })`, which replays the body verbatim (`packages/ui/src/routes/Chat.tsx`, `packages/ui/src/lib/queue.ts:38`).

## Goals / Non-Goals

**Goals**

- Carry one optional project reference from the chat input to the conductor's inbox, with no new endpoint, no new event type and no new client-side storage.
- Make the reference a first-class column, so it is queryable and legible in the database rather than buried in an opaque blob.
- Keep every existing caller — Telegram, the CLI channel, the TUI chat, the core tests — working unchanged by making the field optional at every layer.

**Non-Goals**

- No routing behavior. The conductor's prompt, charter and skills are untouched; this change only makes the hint available.
- No project scoping of threads, no filtering of the chat by project, no second reference per message.
- No new shared UI component. The selector is local to the conductor chat.

## Decisions

### 1. A nullable `project_id` column on `thread_messages`, not a field inside `parts_json`

Migration `0003` adds `project_id TEXT REFERENCES projects(id)` to `thread_messages`, nullable, no backfill, no index.

*Alternative considered: store the reference inside the existing `parts_json` blob.* It needs no migration. Rejected: `parts_json` is the CanonicalMessage content of the message (PLAN §13), not a place for routing metadata; nothing could query it, and every reader would have to know the private key name. The reference is a scalar relationship between two rows and belongs in a column, exactly as `tickets.project_id` is.

*Alternative considered: a reference on `channel_threads` instead of on the message.* Rejected: the ticket asks for the project to travel **with the message**, and the human's project changes from message to message within one thread. A per-thread field cannot show, after the fact, what context a given message carried.

The foreign key is safe because project removal is a soft archive; no `ON DELETE` clause is needed and none is added, matching `tickets.project_id`. No index: nothing queries messages by project, and the table is written on every message.

PLAN §13 enumerates the `thread_messages` columns, so this addition gets an ADR under `docs/adr/`, per the repo's own checklist.

### 2. Validate through `ProjectsService.get`, inside the write transaction, before the insert

`inbound` resolves the reference with `deps().projects.get(projectId)` and lets the resulting `not_found` `OcError` propagate. Because the resolution happens inside `tx(db, …)` before `insertMessage`, a bad reference stores nothing and wakes nobody — which is the spec's rejection scenario, achieved by ordering rather than by cleanup.

Resolving rather than trusting also normalizes the input: `get` accepts an id or a slug and returns the row, so the column always stores the canonical project id and the payload always carries the canonical slug, whichever form the client sent. Cross-workspace references fail for free, since the query is workspace-scoped.

*Alternative considered: validate in the HTTP route with a Zod refinement.* Rejected: the route is one of several entry points into `inbound`, and the invariant "a stored project reference names a project of this workspace" belongs to the service that owns the row.

### 3. The wake payload gains `projectId` and `projectSlug`; `ac_inbox` is not touched

`payload: { threadId, messageId, body, projectId, projectSlug }`, with both project fields `null` when no project was chosen — explicitly present rather than absent, so the conductor can tell "no project" from an older daemon's payload. The slug is carried alongside the id so the conductor can name the project in prose and in `ac_ticket_create` without a lookup; this mirrors the `project_added` payload already in the tree.

The wake's `reason` string also names the project when one was chosen, so the hint is visible in the run log and in the wake list, not only inside the payload.

*Alternative considered: leave the payload alone and let the conductor read the message row.* Rejected: there is no agent tool that returns thread messages, so the conductor would have no way to reach it.

### 4. The default comes from the thread's last human message, not from client storage

The selector's initial value is the `projectId` of the most recent inbound message in the thread — data `ChatRoute` already holds, since `useThreadMessages` is what renders the chat.

*Alternative considered: remember the last choice in `localStorage`, keyed by thread id.* Rejected: it needs new storage and a new key to reason about, it is wrong on a second device, and it is lost when site data is cleared. Deriving from the messages is strictly less machinery and is correct everywhere.

The one behavioral difference worth stating: "the last choice" and "the project on the last message" are the same thing here, including when that choice was "no project" — a message stored with a null reference makes the default "no project", which is what the human last chose. A thread with no messages defaults to "no project".

### 5. The selector renders through `Composer`'s existing `scope` slot

`Composer` already accepts a `scope` node rendered directly above the input, inside the composer block (`packages/ui/src/components/Composer.tsx`), used today by "Revise…" to show what a note is scoped to. The chat passes the selector there.

*Alternative considered: add a new `accessory` prop rendering the control inside the input row next to the mic.* Rejected for now: `Composer` is shared by the chat, ticket comments and decision notes, and a new prop is a new contract on all three for a control only one of them uses. `scope` already means "what this message is about", which is exactly what a project selection is.

The control itself is a native `<select>`: the repo has no select component, a native picker is the right control on a phone, and it is keyboard- and screen-reader-correct with no custom focus management. Archived projects are filtered out of the options, but a message referencing an archived project still resolves its name from the same list for the chip, and falls back to the raw reference if the project is not in the list at all.

The `Composer` line in `docs/design/DESIGN-CONTRACT.md` gains the selector, so the visual contract keeps matching what ships.

### 6. The offline path needs no change

`enqueue` stores `{ path, body }` and the flush replays the body verbatim. Putting `projectId` into the body the chat already builds is the entire offline story — the queue, its storage format and its flush are untouched.

## Risks / Trade-offs

- **A stale default if the same thread is used from two devices at once** → The default is re-derived from the thread's messages on every load and after every send, so it converges on the next fetch. A wrong default is visible before sending and is one click to change.
- **The reference is a hint, and the conductor may ignore or contradict it** → By design; routing is explicitly out of scope. Nothing in the daemon grants access on the strength of the hint, so a wrong project is a wrong suggestion, never a boundary violation. Worker project isolation is unchanged.
- **A new column on a table written on every message** → Nullable, no default computation, no index, no backfill. The insert is one more bound parameter.
- **An older daemon reading a newer database** → The column is additive and nullable; an older build's `SELECT *` simply carries a field it ignores. Rollback is safe without a down-migration, which is the repo's existing posture (`docs/adr/0001`).
- **The `Composer` `scope` slot is styled as small muted text** → It is a container, not a text style; the selector carries its own control styling. If the placement proves wrong visually it is a one-line move to a dedicated prop, with no change to the stored data or the API.

## Migration Plan

One forward-only migration (`0003`) adding a nullable column; it runs on daemon start like every other. No backfill: existing messages keep a null reference, which reads as "no project", which is what they carried. Rollback is reverting the release; the extra column is inert to an older build. The API change is additive, so a client shipped before this change keeps working against a daemon that has it, and a client shipped with it degrades to sending no project against a daemon that does not.

## Open Questions

None. The two judgement calls that could have become questions — the column versus the existing JSON blob, and deriving the default from the thread instead of from client storage — are settled above with their rationale.
