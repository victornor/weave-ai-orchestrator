# Tasks

## 1. Data and API

- [x] 1.1 `packages/db/src/migrations/0047_thread_message_block.sql`: add nullable
  `thread_messages.block_id TEXT REFERENCES roadmap_blocks(id)`, with the rationale comment (blocks
  are set `dropped`, never deleted, so no `ON DELETE` is needed). Verify: a migration test asserts the
  column exists after `openDb`, that a pre-0047 row reads back with `blockId` null, and that the
  foreign key targets `roadmap_blocks`.
- [x] 1.2 `packages/shared/src/types.ts`: `ThreadMessage` gains `blockId: string | null`.
  `packages/core/src/api.ts`: `ThreadsService.inbound`'s opts gain `blockId?: string | null`. Verify:
  `pnpm typecheck` passes.
- [x] 1.3 `packages/core/src/threads/service.ts`: in `inbound`, resolve `opts.blockId` through
  `deps().roadmap.getBlock` before the transaction. A block with no `projectId` throws `validation`; a
  block whose `projectId` differs from the resolved project, or an unknown block, throws `not_found`.
  Store `blockId` on the message and add `blockId`/`blockTitle` to the `human_message` wake payload
  (`blockId: null`, `blockTitle: null` when there is none). Verify: a `threads.test.ts` case sends
  with a project and block and asserts the stored message returns `blockId`, the payload carries
  `blockId` and the block's title, a foreign block is `not_found` with no row and no wake, and a block
  with no project is `validation`.
- [x] 1.4 `packages/server/src/routes/threads.ts`: accept `blockId` in the JSON body and the multipart
  `sendWithAttachments` form, pass it to `inbound`. `docs/API.md`: document `blockId` on
  `POST /threads/:id/messages` beside `projectId`. Verify: `packages/server/test/roadmap.test.ts` or
  the threads integration test sends a message with a block and asserts the wake payload and the stored
  message.

## 2. Composer UI

- [x] 2.1 `packages/ui/src/lib/drafts.ts`: `Draft` gains `blockId?: string | null`, and `isEmpty`
  accounts for it so a block-only meta choice is still a draft. Verify: a `drafts` test round-trips a
  draft with a `blockId` and clears it with the rest.
- [x] 2.2 `packages/ui/src/v2/ChatComposer.tsx`: add a second tag strip, rendered only when the
  selected project has an `open` block. It leads with **Any block** (clears the choice) and lists the
  offered blocks in order; it is a single-select group labelled "Roadmap block for this message", the
  active tag is visually distinct, and it scrolls horizontally rather than wrapping. `onSubmit`'s opts
  gain `blockId`, and the effective block passed to a send is the offered block matching the draft's
  id, or null. Verify: `packages/ui/src/test/v2chatcomposer.test.tsx` asserts the strip appears only
  with an `open` block, that a `dropped`/`started`/foreign block and a project with none are not
  offered, that choosing and sending carries the block, and that clearing sends none.
- [x] 2.3 `packages/ui/src/v2/ChatPage.tsx`: fetch the tagged project's blocks with the existing
  `useRoadmapBlocks`, pass the offered blocks into `ChatComposer`, resolve the effective block from
  the draft, include `blockId` in the send body (JSON and multipart), clear it when the project
  changes, and clear it with the draft on a confirmed send. Verify: a `v2chatpage`/`v2chats` test
  sends with a block chosen and asserts the request body carries `blockId`, and that changing project
  clears it.
- [x] 2.4 Freshness: confirm the existing `roadmap.block.*` SSE invalidation reaches the composer's
  `useRoadmapBlocks` query, so a block created after the composer opened appears. Verify:
  `packages/ui/src/test/events.test.tsx` already asserts a `roadmap.block.*` event invalidates
  `qk.roadmapRoot`, and the case added there asserts `qk.roadmapBlocks` is nested under that root —
  so the composer's query is refreshed without a reload.

## 3. Weaver guidance and docs

- [x] 3.1 `templates/weaver.AGENTS.md.tmpl` and `skills/weave-ai-weaver/SKILL.md`: state that a
  `human_message` payload carrying `blockId`/`blockTitle` means the ask belongs in that block — add it
  with `weave_roadmap_item_add { blockId, title, description }` rather than filing a ticket. Verify:
  `pnpm test` (the tools-guard test over agent-facing prose) stays green, and the wording is readable
  in the rendered skill.

## 4. Checks and rendered evidence

- [x] 4.1 `pnpm lint`, `pnpm typecheck` and `pnpm test` green from `work/`; paste **both** suite blocks
  (core/server and UI) verbatim, never summed and never one presented as both.
- [x] 4.2 Rendered captures in light and dark, at desktop and phone width: a project with `open`
  blocks showing the block strip and a block selected; a project with none showing the unchanged
  composer. Follow the VS-489 harness convention (a throwaway Vite + Playwright page mounting the
  real component against mocked `/api` data, nothing reaching a live daemon), commit the PNGs under
  `docs/reviews/vs-491/` with a README of how they were made and what each shows, and open each capture
  to confirm it shows what was intended. `git status --porcelain` in `work/` is empty before review.
