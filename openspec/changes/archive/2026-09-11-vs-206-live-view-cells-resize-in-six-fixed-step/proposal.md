## Why

Captain, 2026-09-10, on the Live page's resizable cells (VS-164): dragging only reaches one of
three widths and one of two heights — six sizes total, and it feels steppy rather than free.
`packages/ui/src/lib/liveCellSize.ts` stores size as integer CSS-grid spans over a 1–3 column grid
with rows capped at 2, and `snapSize` rounds every drag to the nearest whole span. The module's own
comment names jsdom's blindness to geometry as part of why spans were chosen — a testing constraint
that should not be deciding how the feature feels.

## What Changes

- The Live grid (`/live` and the global `/live`) moves from a 1–3 "slot" grid to a fine CSS-grid of
  **12 tracks at desktop (`xl`) width and 8 at `sm`**, each cell spanning any whole number of
  tracks. A drag now moves in ~1/12 (desktop) or ~1/8 (`sm`) width increments — fine enough to read
  as continuous — instead of snapping between 3 widths.
- Height range grows from 2 steps to **8**, on the same per-track logic as width, so a cell can be
  made proportionally tall the way it can be made wide.
- The equal, never-resized slot keeps its current visual size: 1 old "column slot" / 1 old "row"
  now equals 4 tracks (the chosen granularity), so `DEFAULT_SIZE` becomes `{ cols: 4, rows: 4 }` and
  reads the same width and height it does today.
- Span rendering moves from literal `col-span-N`/`row-span-N` Tailwind classes (impossible to
  enumerate for 12 values without a lookup table) to `gridColumn`/`gridRow` inline style — the
  project already uses inline `style` for other runtime-computed sizes (`Chart.tsx`,
  `BudgetMeter.tsx`, `ContextMeter.tsx`).
- The transcript's max-height, currently a binary "short vs tall" Tailwind class pair, becomes
  proportional to the cell's row-track count via a CSS custom property, so height changes read
  smoothly rather than jumping once at the old 2-row threshold.
- Phone-width tap-to-expand now expands to the new row max (8 tracks), not the old 2.
- The size *model* (`clampSize`, `snapSize`, `columnCount`) is exercised as a pure function, as
  today; the visual result (fine steps, reflow, no overlap, phone/tablet/desktop correctness) is
  checked with the screenshot harness, per the ticket's testability note.

## Capabilities

### Modified Capabilities

- `workspace-navigation/live-floor`: the resize requirement's granularity — width steps fine
  enough to read as continuous (12 tracks at desktop, 8 at `sm`), height adjustable across 8 steps
  instead of 2, and the equal slot's visual size is unchanged.

`workspace-navigation/global-live` already resizes "the same [...] handle the per-workspace Live
page does" — no wording change needed there; it inherits the new granularity because it shares
`LiveCell`/`ResizeHandle` from `Live.tsx`.

## Impact

- `packages/ui/src/lib/liveCellSize.ts` — `columnCount`, `clampSize`, `DEFAULT_SIZE`, the rows cap,
  `sizeOf`; `snapSize` and the storage read/write functions are unchanged (they already operate in
  whatever unit `cols`/`rows` are).
- `packages/ui/src/routes/Live.tsx` — `LiveCell`'s span classes → inline `gridColumn`/`gridRow`
  style; the container grid's `sm:grid-cols-2 xl:grid-cols-3` → `sm:grid-cols-8 xl:grid-cols-12`;
  the transcript max-height binary → proportional; the phone expand target.
- `packages/ui/src/routes/GlobalLive.tsx` — same container grid class change; no other change (it
  reuses `LiveCell`).
- `packages/ui/src/index.css` — a row-unit custom property and its `md:` override, replacing the
  two hardcoded Tailwind max-height classes.
- Tests: `packages/ui/src/test/liveCellSize.test.ts` (new granularity constants and bounds);
  screenshot-harness renders of `/live` at phone, `sm` and `xl` widths, before and after a resize,
  referenced from the PR.
- No API, schema, CLI, Telegram or TUI change.

## Out of scope

- What a cell contains (transcript rendering, tool-call collapsing, streaming).
- Freeform (non-grid) pixel sizing — direction A (a finer grid) is kept; see design.md for why.
- Migrating a size stored under the old 1–3/1–2 unit system: `liveCellSize.ts`'s own comment
  already treats this store as tab-session-scoped and disposable ("a durable store would accumulate
  dead ids"); a cell resized before this change, in a tab still open across the deploy, reads its
  old span numbers as track counts and looks smaller until reset or the next tab/reload. Not
  migrating is deliberate given that scope.
