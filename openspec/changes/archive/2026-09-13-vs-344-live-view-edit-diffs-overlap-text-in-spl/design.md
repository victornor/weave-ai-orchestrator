## Context

See `proposal.md` — Why. This section only records what shapes the approach.

`packages/ui/src/components/DiffHunks.tsx` is the one hunk renderer for two callers: the transcript's
`EditHunk` (`Transcript.tsx`) and the pull-request diff view (`routes/project/PullRequestDiff.tsx`),
after VS-324 extracted it out of the latter. `SplitHunk` renders `grid-cols-2` — Tailwind's
`repeat(2, minmax(0, 1fr))` — with each column a plain `div` whose rows are `flex whitespace-pre`.
The grid track cannot widen, but the row's code span neither shrinks nor wraps, so its text paints
past the track boundary over the divider; that is the overlap. `UnifiedHunk` has the same
`whitespace-pre` and relies on the caller's outer `overflow-x-auto`.

`EditHunk` wraps both hunks in an `@container` and gates them with `@min-[32rem]:block` /
`@min-[32rem]:hidden`, so a real browser chooses split vs unified per rendered instance. jsdom does
not evaluate container queries; the existing tests pin the class contract, not the visible layout
(VS-324 design.md). Live cells are a wrapping grid of fine tracks: 8 tracks at `sm`, 12 at `xl`, a
never-resized cell half the grid, resizable by drag (`lib/liveCellSize.ts`, `routes/Live.tsx`).

## Goals / Non-Goals

**Goals:**

- No line a transcript or pull-request diff renders ever crosses out of its own column or cell,
  at any width.
- The side-by-side/unified choice is made at a width at which two code columns actually read.
- One shared renderer: no fork, and the pull-request view keeps a readable layout.

**Non-Goals:**

- Aligning removed and added lines pairwise GitHub-style; each side stays an in-order list.
- Changing the Live grid, cell sizing, resize granularity or persistence.
- Changing `parseUnifiedDiff`, `diffHunksForEdits`, the `DiffHunk`/`DiffLine` shapes, or the
  transcript pipeline.
- The V2 UI.
- Reconciling `packages/render`'s separate TUI transcript builder; unchanged here.

## Decisions

**Never overlap by wrapping within a constrained box, not by scrolling each column.** A split
column is roughly half the container; an independent horizontal scrollbar per side is not usable, so
the only way to keep every line inside its column is to wrap it. Each split column gets `min-w-0`
(so the flex row's content cannot hold the item open) and the row's code span becomes
`min-w-0 flex-1 whitespace-pre-wrap break-words`, with the line-number span left `flex-none`. Wrapped
continuation therefore hangs under the code, not under the gutter, matching captain's screenshots.
`break-words` (Tailwind for `overflow-wrap: break-word`) handles an unbroken token longer than the
column, so wrapping cannot itself overflow. The same `min-w-0` + `whitespace-pre-wrap break-words`
treatment goes on `UnifiedHunk`'s code span.

**`UnifiedHunk` takes a `wrap` option; `SplitHunk` always wraps.** A unified column uses the full
container width, where a horizontal scroll is a legitimate reading choice, and that is exactly what
the pull-request view does today (`routes/project/PullRequestDiff.tsx`'s `FileBody` has
`overflow-x-auto` and the pull-request-diff spec relies on it). So `UnifiedHunk` defaults to wrapping
(never overflow) and the pull-request view passes `wrap={false}` to keep its scroll. `SplitHunk` has
no non-wrapping mode worth having — a half-width column cannot scroll readably — so it wraps
unconditionally, which also removes the overlap from the pull-request side-by-side view rather than
leaving the shared renderer half-fixed. Alternatives considered: a boolean on both hunks, with the
pull-request view passing `wrap={false}` to both — rejected because it would leave a known-overlapping
side-by-side mode in the shared renderer; forking the renderer for the transcript — rejected by the
ticket and by VS-324's own one-renderer decision.

**The split threshold is `48rem`, up from `32rem`.** The diff renders at `text-nano` (10px) in
JetBrains Mono, whose advance is `0.6em` → 6px per character. A readable code column should hold
about 48 characters (≈288px); each side spends a `w-10` (2.5rem, 40px) line-number gutter plus
`px-1.5` padding, ≈52px, and there is a divider, so two columns need ≈2 × (288 + 52) ≈ 680px =
42.5rem. `48rem` (768px) is the next round container-query stop with margin: ≈332px of code per
column, ≈55 characters. Against the real cell widths: a phone cell and a default half-cell at `sm`
(≈300px) and at `xl` (≈500–620px) all sit below 768px and render unified; only a cell widened past
roughly three quarters of the `xl` grid crosses into split, which is the "there is room for two
columns" case captain described. `32rem` gave ≈204px of code, ≈34 characters each — the too-early
switch the ticket reports. The threshold stays a CSS container query on `EditHunk`'s `@container`, so
a drag-resize crossing it flips the layout live, with no JS measurement and no test-harness geometry
(workspace-navigation/live-floor's jsdom landmine).

**`EditHunk`'s outer `overflow-x-auto` is no longer needed and is dropped.** With both its hunks
wrapping there is no horizontal overflow to scroll; leaving the scroll container would only invite a
stray scrollbar. The pull-request view's own `overflow-x-auto` stays, since its unified hunk still
scrolls.

## Risks / Trade-offs

- **Wrapping a code diff is taller than one line per source line.** → Accepted: the ticket's wanted
  screenshots wrap inside the column, and a wrapped line still reads; the alternative is overlap or
  clipped code. The line-number gutter and per-line background still mark each source line.
- **jsdom cannot evaluate container queries, so the threshold itself is not observable in a test.** →
  The existing convention: pin the class contract (`@min-[48rem]`, `min-w-0`,
  `whitespace-pre-wrap`, `break-words`) and verify the visible result by eye, as VS-324 did. The
  report will state the threshold as verified visually if screenshots are produced, and the class
  contract as what the suite pins.
- **The pull-request side-by-side view changes from overflowing/bleeding to wrapping.** → This is
  the fix the shared renderer needs; the pull-request-diff spec does not forbid wrapping and its
  phone unified path is unchanged. Called out here so it is not mistaken for scope creep.
- **`break-words` can split a long token mid-identifier.** → Accepted: showing the whole line is
  more useful than bleeding into the neighbouring column, and the alternative is a clipped tail.

## Migration Plan

None. A `packages/ui` presentation change, deployed with the ordinary daemon upgrade; no data,
schema, API or stored preference (the pull-request diff layout preference) changes.
