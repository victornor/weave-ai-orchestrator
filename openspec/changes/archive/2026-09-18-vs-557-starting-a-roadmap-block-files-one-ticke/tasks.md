# Tasks — VS-557

- [x] 1. `RoadmapBlockDraft` becomes the merged draft (`title`, `description`, `kind`, `priority`,
      `roleId`, `itemIds`); `RoadmapBlockStart` becomes `{ block, draft: RoadmapBlockDraft | null }`.
- [x] 2. `roadmap.startBlock` builds the one merged draft: block title, every unfiled item as a
      section of the description, highest item priority, common kind/role when they agree, and the
      covered `itemIds`; `null` when no item is left to file.
- [x] 3. `weave_roadmap_block_start`'s tool description states one-ticket-by-default and the named
      split reasons, and no longer says "file each draft".
- [x] 4. The weaver's always-loaded prompt (`templates/weaver.AGENTS.md.tmpl`) encodes the rule and
      drops the "file each draft" wording.
- [x] 5. `skills/weave-ai-weaver` and `skills/weave-ai-planning` state the rule and the named
      split reasons, with no wording left that invites grouping by surface.
- [x] 6. Tests cover the new return shape in core and in the server roadmap tool tests, including
      the empty case and the item sections; the rest of the roadmap tests still pass.
- [x] 7. Lint, typecheck and the full suite pass; suite totals reported on the ticket.
