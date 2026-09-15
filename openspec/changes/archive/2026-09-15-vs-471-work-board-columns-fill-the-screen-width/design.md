# Design — Work board columns fill the screen width

## Context

See `proposal.md` — Why. The board lives in `packages/ui/src/v2/work/Work.tsx`:

- `[data-v2-work-kanban]` is `flex h-full min-h-0 gap-px overflow-x-auto bg-bg-0`.
- Each `<section data-v2-column>` carries an inline `style={{ flex: '0 0 236px', minWidth: 236 }}`
  and `className="flex flex-col border-r border-line-1 bg-bg-0"`.
- The exported constant `V2_KANBAN_COLUMN_WIDTH = 236` is the single source of that width, consumed
  by the test suite as well as the component.
- The six columns come from `foldV2Board`, so the count is data, not a literal, and the map renders
  however many columns the fold returns.

VS-411 replaced VS-387's "narrow empty column" rule with a fixed `0 0 236px` so a board where only
Done has cards shows six equal columns instead of a Done column stretched across the pane. This
ticket keeps that "equal and content-independent" intent and only changes what happens to free
space: the columns take it, equally, instead of leaving it empty at the right.

The inner card scroller keeps `overscroll-x-auto` (VS-411) so a sideways gesture over the cards
chains out to the kanban's horizontal scroller; that is untouched.

## Goals / Non-Goals

**Goals**

- Every column is the same width as every other column, empty or full.
- Above six × 236px the columns grow equally to fill the board; no space is left at the right.
- At or below six × 236px the columns sit at 236px and the board scrolls horizontally.
- Cards grow with their column, keeping their layout and truncation.
- The change is confined to the column style plus its test.

**Non-Goals**

- A maximum column width (no cap is added — see Decisions).
- Changing the phone list, the table view, the column folder, the filters, drag/FLIP or the
  `overscroll-x-auto` scroll chaining.
- Making column width content-driven again.

## Decisions

### Equal-share flex, not a grid

The column's inline style becomes `flex: 1 1 0` with `minWidth: V2_KANBAN_COLUMN_WIDTH`. With a zero
flex-basis, grow distributes the free space equally, so all columns land on the same width; the
explicit `min-width: 236px` floors each one, and because the explicit minimum overrides `min-width:
auto`, the column can never shrink below 236px or be widened by its card's min-content. When the
pane cannot hold six × 236px the filled widths overflow the container and `overflow-x-auto` scrolls.

`grid-template-columns: repeat(n, minmax(236px, 1fr))` would produce the same geometry, but it needs
`n` (the column count) spelled into a style and changes the container from `display: flex` to
`display: grid`, whose interaction with the existing `gap-px`, `overflow-x-auto` and the FLIP
measuring is extra surface for no behavioural gain. Flex keeps the container markup and the
data-driven column map exactly as they are.

### No maximum width

The ticket allows a cap only if the rendered check shows cards unreadable at 2560px. At 2560px each
column is about 426px wide; a card is `w-full` with a truncating title, a truncating worker line and
wrapping tags, so the extra width is used, not clipped. No cap is added, and the columns keep filling
the pane on wider displays.

### One constant, re-documented

`V2_KANBAN_COLUMN_WIDTH` stays the exported minimum so the component and the test share one number.
Its doc comment changes from "one fixed width for every column" to "the minimum width of every
column", recording that the columns now grow equally above it.

## Risks / Trade-offs

- **A card with long unbreakable content could push its column past its equal share.** → The card is
  `w-full` with `truncate` on the title, the worker name and the age, and tags wrap; the column's
  explicit `min-width: 236px` overrides `min-width: auto`, so no card can grow its column.
- **The rendered geometry cannot be asserted in jsdom.** → The unit test asserts the identical
  inline rule (the value the component sets), and the real widths are verified in the rendered check
  against a source-built scratch daemon at 1280×800, 1920×1080, 2560×1440 and 390×844, with the
  measured numbers pasted on the ticket. Before/after captures at 1920 dark, 2560 dark and 1920 light
  are compared.
- **Equal growing columns at a large width could look worse than a capped board.** → The rendered
  check decides; if the captures show unreadable cards, a cap is added and justified here.

## Migration Plan

None: a presentational change to one inline style, no persisted state, no API, no config. Rollback is
reverting the style.

## Open Questions

None.
