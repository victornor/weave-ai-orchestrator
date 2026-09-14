# V2 Work: tickets glide between kanban columns

Tracker change for [VS-426](weave://tickets/VS-426). A `task` ticket, so this change carries tasks
only — `skip_specs: true`.

## Why

Captain, 2026-09-14: "When work moves around between the columns on the Work page, it should be
animated."

`packages/ui/src/v2/work/Work.tsx` renders the board as six `KanbanColumn`s, each mapping its tickets
to `WorkCard`s keyed by ticket id. When a ticket's status changes — live, through the workspace event
stream — React unmounts the card from its old column and mounts it in the new one, so it appears at
its new position in the same frame. Nothing in between: the card jumps, and the cards above and
below it in both columns jump to close or open the gap. On a busy workspace this is the screen's
most frequent visual event and the most obviously unfinished one.

There is no animation layer on this screen today, and no shared motion helper anywhere in `packages/ui`
(`--dur-*` tokens exist in `index.css`, but nothing measures or transitions layout). The sibling
VS-427 polish ticket covers panels, modals, menus and route changes; this change owns the Work board
alone.

## What changes

- **A FLIP layer for the kanban board.** A small, dependency-free helper reads every card's viewport
  box before and after each board change and animates the difference with the Web Animations API
  (transform/opacity only, so the compositor does the work):
  - **Moves** animate from the card's old box to its new one. Within a column the real card is
    transformed; across columns a fixed-position clone flies from the old box to the new one while
    the real card is hidden, then the clone is removed and the card revealed — so a move is not
    clipped by the destination column's scroll container.
  - **Appearing** cards fade and scale in. **Leaving** cards are represented by a clone that fades
    and scales out from where they were.
  - Cards that only shift to open or close a gap move with the rest.
- **Suppression where motion would be noise or jank.** Nothing animates on first paint, when a
  filter, project, finished mode, search or view changes, or while a board query is still resolving.
  Motion is reserved for a change to what the board holds while the filters stand still — a live
  status move, a worker starting, a decision landing, a ticket being filed or finishing.
- **Reduced motion.** `prefers-reduced-motion: reduce` makes every move, entrance and exit instant.
  The Web Animations API is not covered by the stylesheet's reduced-motion override, so the helper
  checks the media query itself.
- **Scroll is untouched.** Animations use transforms and fixed clones, never layout, so each
  column's scroll position is kept.
- **Table view stays instant.** Rows regroup by status wholesale and re-executing a per-row FLIP over
  a long table reads as flicker rather than polish; the report says so. The kanban is the animated
  surface.
- **Tests.** A card that changes status renders in its new column and still opens on click and holds
  keyboard focus; a live board change animates while a filter change does not.

## Out of scope

- The rest of V2's motion vocabulary (VS-427): panels, modals, menus, decision cards, hover/press,
  route changes, and any shared motion tokens.
- The phone ticket list and the merge strip; both remain as they are.
- Data-shape or server changes. This is presentation only.
