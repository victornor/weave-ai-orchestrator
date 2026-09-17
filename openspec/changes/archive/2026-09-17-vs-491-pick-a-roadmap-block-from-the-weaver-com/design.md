## Context

See `proposal.md` — Why. The current state that shapes the approach:

- The conductor chat's project selector is `packages/ui/src/v2/ChatComposer.tsx`, a horizontal
  single-select strip of tags controlled entirely by its parent: `ChatPage.tsx` holds the chosen
  project in the per-thread draft (`lib/drafts.ts`) and passes it in; a send puts `projectId` on the
  `POST /threads/:id/messages` body.
- On the server, `ThreadsService.inbound` (`packages/core/src/threads/service.ts`) resolves
  `projectId` through `ProjectsService.get` *before* the transaction, so an unknown project stores
  nothing and wakes nobody; it stores `project_id` on `thread_messages` and adds `projectId` and
  `projectSlug` to the `human_message` wake payload (ADR 0005).
- A project's blocks are already served by `GET /projects/:id/roadmap/blocks`
  (`useRoadmapBlocks`, `packages/ui/src/api/hooks.ts`) and each block carries a stored `status`
  (`open | started | dropped`) and a derived `reportedStatus` (`open | started | done | dropped`).
  The UI's SSE handler already invalidates the blocks query on `roadmap.block.*` events
  (`packages/ui/src/api/events.ts`).
- The roadmap tools already place an ask in a block (`weave_roadmap_item_add { blockId, … }`), so
  nothing in the roadmap layer changes.

## Goals / Non-Goals

**Goals:**

- A project-scoped block choice in the composer, carried to the weaver as structured data and
  validated against the tagged project at the boundary.
- A durable, readable block reference on the message, mirroring the project reference.
- The weaver is told what a block reference on a human message means.

**Non-Goals:**

- Creating or editing blocks from the composer.
- Changing how the weaver decides between a ticket and a roadmap item.
- A visual marker of the block on a sent message (the ticket does not ask for one; the project marker
  stays as it is). The stored `blockId` is available should it be wanted later.
- The dictation work in VS-489, and V1's composer (`components/Composer.tsx`), which has no project
  selector.

## Decisions

### The offered set is exactly the project's `open` blocks

A block is offered when its reported status is `open` — the lifecycle state in which a block collects
pending tickets before it is started. `started`, `done` and `dropped` blocks are not offered. This
matches the ticket's wording ("open roadmap blocks") and the block lifecycle: once a block is
started, its items are already being filed, so a new ask no longer belongs in it.

Alternative considered: offer `open` and `started` blocks ("still open to new items"). Rejected as
the default because the ticket names open blocks and only ever excludes `dropped` in its acceptance;
if a started block should also be offered, that is a one-line widening of the filter and is visible
at plan review.

Blocks are filtered on the client from the existing `useRoadmapBlocks` result. No new route, and no
server-side filtering parameter, because the composer already has the project's whole block list.

### A second strip, not a wider project strip

The project tags and the block tags are two levels of one choice, so the block options render as a
separate strip below the project strip, shown only when the project has offerable blocks. Merging
them into one strip would make project tags and block tags visually indistinguishable and would put
a foreign project's block next to another project's tag.

The strip follows the project strip's existing language: a leading **Any block** tag for "no block",
`v2-tag` styling, `aria-pressed` on the active option, and a `role="group"` with an accessible label.
It is omitted entirely when there is nothing to offer, so the composer is byte-for-byte its current
self in that case.

### The block is stored on the message, and validated at the boundary

Migration `0047` adds nullable `thread_messages.block_id TEXT REFERENCES roadmap_blocks(id)` (no
`ON DELETE` clause: blocks are not deleted, only set `dropped`, so the reference cannot dangle — the
same posture as ADR 0005). `ThreadsService.inbound` resolves the block through
`RoadmapService.getBlock` before the transaction, the same shape it already uses for the project:

- a block with no project reference is `validation`;
- a block that does not exist, or whose project differs from the tagged project, is `not_found`;
- either way nothing is stored and no wake is enqueued.

The wake payload gains `blockId` and `blockTitle` beside `projectId`/`projectSlug`, so the weaver can
act without a second read. `blockId: null` is explicit when there is no block, mirroring the project
fields.

Alternative considered: keep the block only in the payload and store nothing. Rejected — the project
reference is durable and returned on reads, and a block reference that vanishes on a failed wake
would be inconsistent with it.

### The composer sends the *offered* block, not the draft's block id

`ChatPage` derives the effective block as the block in the currently-offered list whose id matches
the draft's `blockId`, and passes that to the composer and to `onSubmit`. A draft that names a block
which has since been dropped, started, or belongs to a project the human has since left therefore
neither shows as chosen nor reaches the request. The server's validation is the second line of
defence, not the first.

Changing the project clears the block choice at the same time (`patch({ projectId, blockId: null })`),
and a confirmed send clears both with the rest of the draft.

### Freshness through the existing query, not a snapshot

The composer reads `useRoadmapBlocks(projectId)`, keyed by project, and the app's SSE handler already
invalidates the roadmap query root on `roadmap.block.*` events. A block created after the composer
was opened therefore appears without a reload, which is the acceptance's "reflects blocks that
currently exist". No polling and no local snapshot.

### The weaver is told what the reference means

`templates/weaver.AGENTS.md.tmpl` and `skills/weave-ai-weaver/SKILL.md` gain a sentence to the block
guidance: a `human_message` payload carrying `blockId`/`blockTitle` means the ask belongs in that
block, added with `weave_roadmap_item_add` rather than filed as a ticket. This is content, not
behavior in code, so it is a task and a doc change rather than a spec requirement.

## Risks / Trade-offs

- [The offered set (`open` only) could be wider than the ticket intends] → it is an explicit,
  visible decision here and in the proposal; widening to include `started` is a one-line filter
  change.
- [A second strip could grow the composer on a phone] → it renders only when a project with `open`
  blocks is selected, scrolls horizontally rather than wrapping, and is otherwise absent, so a
  project with no blocks is unchanged.
- [A stale draft could carry a block that no longer exists] → the effective block is resolved from
  the live offered list, and the server refuses an unknown or foreign block.
- [The block title in the payload could drift from the block's current title] → the payload is
  advisory routing context read at wake time; the weaver's `weave_roadmap_item_add` names the block
  by id, which is stable.

## Open Questions

None.
