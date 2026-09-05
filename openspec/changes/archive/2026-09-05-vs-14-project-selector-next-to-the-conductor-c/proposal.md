## Why

A workspace holds many projects, but a message to the conductor carries no project. The human has to name the project in prose in every message, or the conductor guesses the referent of "do this" from the transcript. Nothing in the pipe can help: an inbound web message is stored as a `thread_messages` row with a body and nothing else, and the wake it enqueues carries `{ threadId, messageId, body }` — the first 2000 characters of the same prose (`packages/core/src/threads/service.ts:119`, `:127`). There is no structured place for the answer, so the conductor re-derives it every turn and gets it wrong when the human is terse.

The chat already knows the projects — `ChatRoute` calls `useProjects()` today, only to decide whether to show the onboarding bar. The missing piece is a way for the human's choice to travel with the message.

## What Changes

- **A message can carry an optional project reference, end to end.** `thread_messages` gains a nullable `project_id` column (migration `0003`), surfaced as `projectId` on the `ThreadMessage` DTO and therefore on `GET /threads/:id/messages`.
- `POST /api/w/:ws/threads/:id/messages` accepts an optional `projectId`. It is validated against the workspace's projects and rejected when unknown. Omitting it is the current behavior exactly, so this is **not** a breaking change.
- The `human_message` wake payload gains `projectId` and `projectSlug`, so the conductor sees the hint in `ac_inbox` without a second lookup and without parsing prose. What the conductor then does with it is its own prompt's business, not this change's.
- **The web conductor chat gets a compact project selector beside the composer**, listing the workspace's projects plus an "all projects" option that means no hint. The choice travels with the send, including a send made offline and flushed later.
- **The selector defaults to the project the thread last used** — read off the most recent inbound message in the thread, so the default is server-side state and is the same on every device with no new storage.
- **A sent message shows the project it carried**, as a chip on the message, so the human can see after the fact what context went with it. A message sent with no project shows no chip and looks exactly as it does today.
- An ADR records the `thread_messages` schema extension, since PLAN §13 enumerates that table's columns.

## Capabilities

### New Capabilities
- `conductor-chat/message-project-context`: how a human message to the conductor carries an optional project reference — choosing it, storing it, showing it back, and delivering it to the conductor — and what happens when no project is chosen.

### Modified Capabilities

(None. `openspec/specs/` holds no capabilities yet, so the additive change to the thread-message API and the wake payload is specified inside the new capability as the contract the chat depends on.)

## Impact

- `packages/db/src/migrations/0003_*.sql` — nullable `project_id` on `thread_messages`, forward-only, no backfill.
- `packages/shared/src/types.ts` — `projectId` on `ThreadMessage`.
- `packages/core/src/api.ts`, `packages/core/src/threads/service.ts` — `projectId` in `inbound`'s options, validated, persisted, and carried into the `human_message` wake payload.
- `packages/server/src/routes/threads.ts` — optional `projectId` on the message body.
- `packages/server/src/tools.ts` — nothing; `ac_inbox` already returns the wake payload verbatim, so the new fields surface without a change there.
- `packages/ui/src/routes/Chat.tsx`, `packages/ui/src/api/hooks.ts`, `packages/ui/src/api/types.ts` — the selector, the default, the send, the offline-queue body, and the chip on the message.
- `docs/API.md` — the new request field on `POST /threads/:id/messages`.
- `docs/adr/0005-*.md` — the schema extension.
- Tests: core tests for the round-trip (stored reference and wake payload) and for the unknown-project rejection, a server route test for the request field, and UI tests for the default, the send and the chip.
- No change to the run engine, the wake queue, the conductor's prompt or charter, the Telegram or CLI channels, or the TUI chat.

## Out of scope

- How the conductor routes once it has the hint — its prompt, charter and skills are not touched.
- Per-message project selection in Telegram, the CLI or the TUI chat. Those channels keep sending no project, which is the unchanged path.
- Binding a whole thread to a project, or filtering the chat by project.
- Anything to do with threads bound to a ticket: those messages already land as ticket comments on a ticket that has a project, and that path is untouched.
