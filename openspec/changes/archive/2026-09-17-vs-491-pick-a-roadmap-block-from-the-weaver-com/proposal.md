# Pick a roadmap block from the weaver composer's project tag

Tracker change for [VS-491](weave://tickets/VS-491). A `change` ticket in project `agent-conductor`.

## Why

Choosing a project tag in the weaver composer already routes a message to that project. Putting the
same ask on one of that project's roadmap blocks still means writing "add it to the UI polish block"
in prose and trusting the weaver to match the name, even though the block is the natural home for a
small related ask and the routing decision is already being made in the composer.

## What Changes

- **The composer offers the tagged project's open blocks.** With a project selected, a second tag
  strip appears beside the input: a leading **Any block** option plus one tag per block of that
  project whose reported status is `open` — a block still collecting pending tickets. No project, or
  a project with no such block, offers nothing and the composer looks exactly as it does today. The
  choice is clearable, is kept with the draft, clears when the project changes and after a confirmed
  send, and a `started`, `done` or `dropped` block — or one belonging to another project — is never
  offered.
- **The choice travels as structured intent.** `POST /threads/:id/messages` accepts an optional
  `blockId`. It is resolved and validated against the tagged project before anything is written
  (unknown or foreign block → `not_found`, a block with no project → `validation`), stored on the
  message, and the `human_message` wake payload carries the block's id and title alongside the
  project it already carries. Nothing is appended to the message body.
- **The weaver is told what to do with it.** The weaver prompt and skill say that a `human_message`
  payload carrying a block means the ask belongs in that block — added with `weave_roadmap_item_add`
  rather than filed as a ticket.
- **Specs, docs, schema.** `conductor-chat/message-project-context` gains the block reference, the
  composer strip and the structured payload; `conductor-chat/composer-drafts` gains the block being
  kept with the draft; `docs/API.md` documents the new field; migration `0047` adds the nullable
  `thread_messages.block_id` column.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `conductor-chat/message-project-context`: a human message may carry a roadmap block of its own
  project, scoped and validated with it; the composer offers the tagged project's open blocks beside
  the project selector; the `human_message` wake payload carries the block's id and title.
- `conductor-chat/composer-drafts`: the chosen roadmap block is kept with the draft it was chosen
  for, restored with it, and cleared by a confirmed send.

## Impact

- `packages/db/src/migrations/0047_thread_message_block.sql` — nullable
  `thread_messages.block_id TEXT REFERENCES roadmap_blocks(id)`, plus the migration test.
- `packages/shared/src/types.ts` — `ThreadMessage.blockId`.
- `packages/core/src/api.ts`, `packages/core/src/threads/service.ts` — `inbound` accepts `blockId`,
  resolves it against the project, stores it, and puts `blockId`/`blockTitle` in the wake payload.
- `packages/server/src/routes/threads.ts` — `blockId` on the JSON and multipart message bodies.
- `packages/ui/src/lib/drafts.ts`, `packages/ui/src/v2/ChatComposer.tsx`,
  `packages/ui/src/v2/ChatPage.tsx` — the block strip, its draft persistence, and the send body.
- `docs/API.md`, `templates/weaver.AGENTS.md.tmpl`, `skills/weave-ai-weaver/SKILL.md` — the field and
  the weaver's handling of it.
- No new HTTP route and no change to the roadmap tools or the block lifecycle.
