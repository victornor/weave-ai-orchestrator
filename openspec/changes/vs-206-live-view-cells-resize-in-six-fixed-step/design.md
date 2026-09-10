## Context

See proposal.md. `packages/ui/src/lib/liveCellSize.ts` stores `CellSize { cols, rows }` as integer
CSS-grid spans over `columnCount()` (1/2/3 by breakpoint) with `rows` capped at 2 by `clampSize`.
`Live.tsx`'s `LiveCell` renders the span as a literal Tailwind class (`col-span-2`, `col-span-3`,
`row-span-2`), and `ResizeHandle.startDrag` measures the rendered cell's current pixel size to
derive a per-span pixel unit (`unitW = rect.width / size.cols`), which `snapSize` then uses to
round a drag delta to the nearest whole span. `GlobalLive.tsx` reuses `LiveCell` unchanged.

The ticket's own recommendation (direction A: keep the grid, make it finer, "something like 12")
is accepted; this document is the granularity and the mechanics, not a re-litigation of A vs. B.

## Goals / Non-Goals

**Goals:**

- Dragging moves in increments fine enough to read as continuous, at every breakpoint that allows
  drag-resize.
- Height gets a comparably wider range, not just width.
- The never-resized equal slot keeps its current visual size — this change must not make every
  existing cell suddenly look smaller.
- `snapSize`/`clampSize`/`columnCount` stay pure functions, unit-testable without geometry.

**Non-Goals:**

- Freeform pixel sizing (direction B) — explicitly rejected by the ticket.
- Migrating a size stored under the old unit system (see proposal.md's Out of scope).
- Changing what a cell contains, or Global Live's non-resize behavior.

## Decisions

### 1. Finer tracks, not a unit change — `GRANULARITY = 4`

Rather than switching `cols`/`rows` to a different kind of unit (percent, pixels), the grid simply
gets more, narrower tracks, and `cols`/`rows` keep meaning "how many tracks this cell spans" — the
same meaning they have today, just against a bigger `colsMax`.

Define `GRANULARITY = 4` sub-tracks per one old "slot" (a column tier or a row step):

| Breakpoint | Old `columnCount()` | New `columnCount()` (tracks) |
|---|---|---|
| `< sm` | 1 | 4 (not drag-resized: phone uses tap-expand, §5) |
| `sm`–`xl` | 2 | 8 |
| `≥ xl` | 3 | 12 |

`≥ xl` landing on exactly 12 matches the ticket's own suggested number. Rows: old cap 2 → new cap
`ROWS_MAX = GRANULARITY * 2 = 8`, a constant across breakpoints (rows were never breakpoint-scaled).
8 is a smaller number of steps than 12 by the same ratio the old caps had (2 vs. 3) — "comparable",
not identical, on purpose: unbounded vertical growth pushes more content below the fold than a wide
cell does, so it stays the more conservative axis.

`DEFAULT_SIZE` becomes `{ cols: GRANULARITY, rows: GRANULARITY }` (`{ 4, 4 }`): 1 old slot × 1 old
row is now 4 tracks in the finer grid, at every breakpoint (1 slot of 2 is 4 of 8; 1 slot of 3 is 4
of 12) — the equal slot's rendered width and height are unchanged by this migration.

**Why not a percent/float unit instead:** `snapSize`'s whole-unit rounding and jsdom-free pure-
function testing both depend on integer spans; floats would need a new epsilon-comparison story for
no behavioural gain — a bigger integer range already delivers "reads as continuous".

**Alternative considered:** keep `colsMax` at 3/2/1 and only grow `rows`. Rejected — the ticket's
complaint and AC1 are specifically about width steppiness.

### 2. Span rendering moves from Tailwind classes to inline `gridColumn`/`gridRow`

`col-span-N` only works as a literal class Tailwind's scanner can see in source text. Twelve column
values and eight row values would need a hand-written literal lookup array (`['', 'col-span-1', ...
'col-span-12']`) purely to satisfy the scanner — a maintenance trap the moment the granularity is
retuned. Inline style has no such constraint and the project already uses it for other runtime-
computed sizes (`Chart.tsx`, `BudgetMeter.tsx`, `ContextMeter.tsx`, `TicketPage.tsx`):

```tsx
style={{ gridColumn: `span ${shown.cols}`, gridRow: `span ${shown.rows}` }}
```

The container grid's own track counts (`sm:grid-cols-8 xl:grid-cols-12`) stay literal Tailwind
classes — those are fixed at build time per breakpoint, not computed from a cell's state, so the
scanner sees them normally.

### 3. Transcript height becomes proportional, via a CSS custom property

Today `RunTranscript`'s wrapper picks one of two Tailwind `max-h-[calc(...)]` classes based on
`shown.rows >= 2` (`tall`). With 8 row steps a binary switch would jump once and then do nothing for
the other 7 steps. Replace it with one CSS rule driven by a custom property carrying the row count:

```css
/* index.css */
.ac-live-transcript {
  max-height: calc(var(--ac-app-h) * 0.25 * var(--ac-cell-rows, 1));
}
@media (min-width: 48rem) {
  .ac-live-transcript { max-height: calc(var(--ac-app-h) * 0.3 * var(--ac-cell-rows, 1)); }
}
```

`LiveCell` sets `style={{ '--ac-cell-rows': shown.rows / GRANULARITY }}` on the transcript wrapper
— normalized to GRANULARITY units, not raw tracks, so `1` is the default size and `2` is the row
max (`ROWS_MAX / GRANULARITY`). Linear scaling in that unit means `1` reproduces today's pre-change
default fractions (`0.25`/`0.3`) exactly, and `2` reproduces today's old two-row "tall" fractions
(`0.5`/`0.6`) exactly — every size in between grows smoothly instead of jumping once at a
threshold. Verified by eye against the screenshot harness (§6), not asserted as a spec-level number.

**Why not keep two Tailwind tiers and add a third:** three fixed tiers over 8 steps still jumps;
the point of this change is that height reads continuously the way width does.

### 4. `clampSize`'s row cap becomes a named constant, not a literal `2`

`clampSize(size, colsMax)` hardcodes `Math.min(..., 2)` for rows. It becomes `Math.min(..., ROWS_MAX)`
with `ROWS_MAX = GRANULARITY * 2` exported alongside `DEFAULT_SIZE`, so the apply phase has one
place to change if this number is retuned later, and `expanded` (phone tap-to-expand) targets
`ROWS_MAX` instead of a hardcoded `2`.

### 5. Phone width is unchanged in kind, not in number

Below `sm`, `Live.tsx` already renders tap-to-expand instead of drag (fighting page scroll on a
single column was the original reason). That does not change here. `columnCount(false, false)`
still returns a number (now 4, for `clampSize` consistency when a size chosen at desktop is viewed
on a phone) but no UI at that width offers width-dragging, so 4 tracks are never fanned out into a
visible sub-grid at phone width.

### 6. Verification: pure-function tests plus the screenshot harness

`columnCount`, `clampSize`, `snapSize`, `sizeOf` get updated expectations for the new constants
(same shape as today's tests, new numbers) — this is what proves the size *model* is correct without
needing jsdom geometry. The visual claims (steps read as continuous, no overlap, reflow, phone /
`sm` / `xl` correctness, restore-on-reload) are checked by rendering `/live` through the existing
`ui-screenshot-harness` at each breakpoint, before and after a simulated resize, with the images
referenced in the PR per the ticket's Testability note and acceptance criterion 5.

## Risks / Trade-offs

- [A tab open across the deploy has an old-unit stored size] → reads as a smaller cell under the
  new grid until reset or the next reload/tab open. Accepted; see proposal.md's Out of scope —
  session-scoped storage was already designed as disposable.
- [Retuning the height-fraction constants later needs a design call, not just a number swap] →
  scoped to `index.css`, one rule and its `md:` override; low blast radius.
- [12/8 tracks is still finite, not truly freeform] → deliberate; direction B was rejected by the
  ticket for the layout problems it would reopen.

## Migration Plan

No schema, no server change. Ships as a single PR; rollback is revert. No data migration (see Out
of scope) — worst case after rollback is a tab that briefly saw the new granularity's stored values
misread against the old caps, which `clampSize` still bounds rather than breaking.
