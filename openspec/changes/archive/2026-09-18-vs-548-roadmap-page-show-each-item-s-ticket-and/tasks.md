## 1. Device-remembered collapse preference

- [x] 1.1 In `packages/ui/src/v2/prefs.ts` add `readRoadmapExpanded(): ReadonlySet<string>` and `writeRoadmapExpanded(ids: ReadonlySet<string>)` for the key `weave.v2.roadmap.expanded` (a JSON array of expanded block ids), returning an empty set on an absent, junk or throwing `localStorage` and dropping non-string entries; verify with a pure test that a stored array round-trips, junk and a throwing `localStorage` read as empty, and no throw escapes the write.

## 2. Blocks collapse, collapsed by default

- [x] 2.1 In `packages/ui/src/v2/project/RoadmapPage.tsx` give `BlockCard` an expanded state seeded from `readRoadmapExpanded()`, a header `<button aria-expanded aria-controls>` with the rotating chevron and the `<h2>` title, the status tag and an always-visible `N items` count in the header, and render notes and the pending list only when expanded; toggling writes the new set through `writeRoadmapExpanded`; verify the block renders collapsed on first load with its title and count, expands to show its items, and collapses again.

## 3. Each pending item's ticket and status

- [x] 3.1 In `RoadmapPage.tsx` change the ticket query to `useTickets({ project: project?.id, limit: 500, includeTerminal: true })` and resolve an item's `ticketId` to its ticket, so a linked terminal ticket (a `done` block) resolves too; verify a linked `done` ticket resolves in the test.
- [x] 3.2 Add `TICKET_STATUS_TONE` and render a `PendingRow`'s ticket state: a resolved ticket as the `VS-nnn` link to it plus its status as a toned `v2-tag`; `ticketId === null` as a muted `unfiled` tag; a linked but unresolved id as a muted `filed` tag, never `unfiled`; verify each of the three states in the test.

## 4. Tests and docs

- [x] 4.1 Update `packages/ui/src/test/v2roadmap.test.tsx`: mock tickets with a `status`; assert blocks start collapsed and show title + item count; expand to assert items; assert a linked item shows the identifier link and its status; assert an unlinked item shows `unfiled`; assert the preference key is written on toggle and an expanded id read from `localStorage` shows that block expanded on mount; assert an item whose linked ticket is `done` shows `done`; run `pnpm --filter @weave-ai/ui test` and confirm green.
- [x] 4.2 Update the Roadmap-page sentence in `docs/PLAN.md` §21.1 to mention each pending ticket's status beside its link and that blocks are collapsible, collapsed by default.

## 5. Verification

- [x] 5.1 On a source-built scratch daemon only (`scripts/scratch-daemon.sh`, explicit config dir, loopback port other than 7433, stopped only by its recorded PID — never the live daemon, never 7433), seed a project with an open block, a started block holding a linked ticket with a non-terminal status and an unfiled item, a done block whose tickets are terminal, and a loose item; capture the Roadmap page in light and dark at desktop width and at phone width, with blocks collapsed and one block expanded, showing the linked status and the `unfiled` marker; keep the captures outside `work/` and attach them to VS-548 with `weave_ticket_attachment_put` rather than citing paths.
- [x] 5.2 Run `pnpm lint`, `pnpm typecheck` and `pnpm test`; paste both suite blocks verbatim in the report (core/server and UI, never merged into one figure).
- [x] 5.3 Confirm `git status --porcelain` in the worktree is empty before requesting review, and that no GitHub-hosted Actions run was triggered.
