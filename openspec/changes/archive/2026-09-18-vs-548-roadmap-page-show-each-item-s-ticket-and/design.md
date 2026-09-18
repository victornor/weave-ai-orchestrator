## Context

See `proposal.md` — Why. Ground truth verified against this worktree:

- The Roadmap page is `packages/ui/src/v2/project/RoadmapPage.tsx`, routed at
  `p/$project/roadmap` (`packages/ui/src/router.tsx:134`). It reads blocks from `useRoadmapBlocks`,
  loose items from `useRoadmap`, and resolves a pending item's ticket **identifier alone** by looking
  its `ticketId` up in `useTickets({ limit: 300 })` (`RoadmapPage.tsx:37-40`); it never shows the
  ticket's status.
- `RoadmapItem.ticketId` is the link; the ticket's identifier and `status` live on the `Ticket` row
  (`packages/shared/src/types.ts:102`). The workspace event stream already invalidates
  `qk.tickets(ws)` on every `ticket.status` event (`packages/ui/src/api/events.ts:423-428`), so a
  status resolved from that query updates without a reload — this is the page's existing freshness
  mechanism.
- **The current ticket query hides terminal tickets and is not project-scoped.** `GET /tickets`
  excludes `done`/`cancelled` unless `includeTerminal=true`, and the core service caps the page at
  500 (`packages/core/src/tickets/service.ts:980-987`). So today a `done` block's items resolve to no
  link at all. Part 1 cannot be met without asking for terminal tickets.
- Device-remembered display preferences live in `packages/ui/src/v2/prefs.ts` (the rail's
  `weave.v2.rail`, the Live floor's `weave.v2.live.*`), each read/written in a `try/catch` so private
  mode degrades to the default.
- The app's existing disclosure idiom is `V2ProjectSection` (`packages/ui/src/v2/project/sections.tsx:44-80`):
  a full-width `<button aria-expanded={open} aria-controls={bodyId}>` with a `▸` that rotates 90°, and
  the body not rendered when collapsed. Blocks in `RoadmapPage.tsx` are plain `<section>`s today.
- `v2-tag` is the shared micro tag class (`packages/ui/src/index.css:837`); tones are Tailwind token
  utilities (`text-text-2`, `text-working`, `text-merging`, `text-blocked`, `text-done`), never raw hex
  — `pnpm lint` rejects raw hex and px in components.

## Goals / Non-Goals

**Goals:** a block pending item reads "VS-nnn, <status>" with a live status or an explicit `unfiled`;
each block collapses, starts collapsed, still shows title and item count, and remembers its choice in
this browser; the control is usable at phone width; both behaviors tested and captured in both themes
at desktop and phone width.

**Non-Goals:** changing loose-item rendering (they can be plain ideas, so "unfiled" would mislabel
them), any server, schema, API or event change, persisting the collapsed choice anywhere but the
browser, collapsing the loose-items group, drag-and-drop, animation requirements.

## Decisions

### Decision 1 — Resolve the status from the ticket list, project-scoped and including terminal

Change the page's ticket query to `useTickets({ project: project?.id, limit: 500, includeTerminal: true })`
and resolve each item's `ticketId` to `{ identifier, status }` from it. Rendering uses the ticket's
`status` directly.

- **Why include terminal.** The acceptance explicitly wants a `done` block to read as done; with the
  current query a terminal ticket is absent, so its item would fall to the unfiled/unknown branch.
  This is the change that makes the done case true, and it is also what the "live status" scenario
  needs (done is a status).
- **Why project-scope.** The page only ever resolves this project's tickets; scoping keeps the query
  small and raises the effective ceiling from a workspace-wide page to the project's recent 500.
- The event stream's `ticket.status` invalidation is unchanged, so the displayed status tracks the
  ticket live. No new hook, no polling, no backend field.

### Decision 2 — Three honest item states, and only block items get the unfiled marker

`PendingRow` renders its ticket state from `item.ticketId`:

| `ticketId` | rendered |
|---|---|
| `null` | a muted `v2-tag` reading `unfiled` (title: no ticket filed yet) |
| resolved in the list | `VS-nnn` link to the ticket + its status as a toned `v2-tag` |
| set but not resolved (outside the page window) | a muted `filed` tag — never `unfiled`, which would be a lie |

The unresolved-but-linked state exists because the ticket list is paginated (500). It is deliberately
distinct from `unfiled`, so a filed item is never mislabeled. Loose items keep VS-478's rendering: an
unlinked loose item is an idea, not an unfiled pending ticket.

- **Why not the block's items only:** part 1's wording is "each pending item", which is the block
  item; loose items are a different entity and already have their own `idea|planned|dropped` tag.

### Decision 3 — One status tone map, tokens only

Add `TICKET_STATUS_TONE: Record<TicketStatus, string>` beside `BLOCK_TONE`: early/queued statuses
(`backlog`, `todo`, `proposing`, `proposed`, `approved`, `in_review`) read `text-text-2`;
`in_progress` → `text-working`; `merging` → `text-merging`; `blocked` → `text-blocked`; `done` →
`text-done`; `cancelled` → `text-text-4 line-through`. The label uses the uppercase micro tag so it
reads as `IN REVIEW`, matching the page's existing kind/priority tags.

### Decision 4 — Expanded block ids are the remembered set, defaulting to collapsed

The page holds a `Set<string>` of expanded block ids, seeded from a new prefs helper. Because the
default is *collapsed*, the absent/junk value must mean "nothing expanded", so the stored polarity is
**expanded** ids:

- key `weave.v2.roadmap.expanded`, value a JSON array of block ids;
- `readRoadmapExpanded(): ReadonlySet<string>` returns an empty set on absent, junk, or a throwing
  `localStorage`, and drops non-string entries;
- `writeRoadmapExpanded(ids)` writes the array, swallowing a throwing `localStorage`.

A single browser-wide key is enough because block ids are unique; scoping it to a project would add
bookkeeping without changing behavior. Stale ids for removed blocks are harmless.

### Decision 5 — The collapse control reuses the app's disclosure idiom

`BlockCard` becomes a header `<button aria-expanded={expanded} aria-controls={bodyId}>` containing the
rotating `▸` and the `<h2>` title, with the status tag and an always-visible item count beside it (the
count is in the header, so a collapsed block still satisfies "title and how many items"). The body —
notes and the pending list — is rendered only when expanded. The button is `flex-1` with the tags
`flex-none`, so on a phone the whole header row is the tap target.

- **Why count "N items" not "N pending":** a started or done block's items are mostly filed, so
  "pending" was already imprecise; the count is the block's size, which is what a collapsed block
  should advertise.

## Risks / Trade-offs

- **A project with more than 500 tickets could still miss a linked ticket.** → It renders `filed`
  rather than a wrong state, and the roadmap's own items are recent, so the window is not usually
  reached.
- **Changing the page's ticket query alters existing behavior** (terminal tickets now resolve links).
  → That is the intended fix; the test asserts a `done` ticket resolves with status `done`.
- **Expanding a block renders its markdown notes and items.** → Same as before, only on demand.
- **The existing `v2roadmap.test.tsx` assumes every block is expanded.** → It is updated in this
  change to expand before asserting item content, and gains cases for the collapsed default, the
  remembered choice, the ticket status, and the unfiled marker.

## Migration Plan

None — client-only, no persisted server data. Deploy is the owner's `weave daemon upgrade`, not this
ticket's. Rollback is reverting the UI change; the browser key is inert without it.

## Open Questions

None. The one judgement call (loose items keep their current rendering) is settled in Decision 2.
