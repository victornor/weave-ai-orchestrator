# Work board columns fill the screen width

## Why

On a wide window the V2 Work board's six kanban columns stop at a fixed 236px each and leave the
rest of the pane empty. That fixed width was VS-411's follow-up to VS-387 (a column must never
stretch to fill free space because only Done has cards), but on a large display it wastes the width
they were given. Captain wants the columns to use it: equal width, expanding together to fill the
pane.

## What Changes

- **Every kanban column grows equally.** Columns change from `flex: 0 0 236px` to an equal-share
  flex (`flex: 1 1 0`) with a 236px minimum, so all six are the same width as each other — empty or
  full — and grow together to fill the pane with no empty space at the right.
- **The board still scrolls when it must.** Once the pane is narrower than six × 236px = 1416px the
  columns sit at 236px and the board scrolls horizontally, exactly as it does today.
- **No maximum width.** Columns keep growing on very wide displays (2560px and beyond); the rendered
  check confirms the cards stay readable there, so no cap is added.
- **Cards follow their column.** A card already spans its column (`w-full`), so its internal layout
  and truncation are unchanged — it grows with the column.
- **Everything else is unchanged:** the phone list, the table view, drag/FLIP animations, and the
  `overscroll-x-auto` horizontal-scroll chaining added by VS-411.
- **Tests.** `packages/ui/src/test/v2work.test.tsx` stops asserting `0 0 236px` per column and
  asserts instead that every column shares one identical, growing flex rule with a 236px minimum.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `web-v2/work`: the requirement **Empty columns are narrow and cards widen them** is replaced by
  one stating that every kanban column takes an equal share of the pane and grows to fill it, with a
  236px minimum below which the board scrolls horizontally.

## Impact

- `packages/ui/src/v2/work/Work.tsx` — `V2_KANBAN_COLUMN_WIDTH` and the column `style`.
- `packages/ui/src/test/v2work.test.tsx` — the column-width assertions.
- No daemon, API, schema, config or data change; a UI-only, presentational change with no backend
  contract and no migration.
