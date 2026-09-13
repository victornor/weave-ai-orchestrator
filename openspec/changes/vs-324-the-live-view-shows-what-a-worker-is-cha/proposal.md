## Why

A live-worker transcript today collapses every tool call to a one-line row: an `Edit` shows a file
path and a `+N −M` count, a `Write` shows nothing beyond the path, and the Live grid packs three
cells per row on desktop. Captain wants to actually watch a worker's edits happen — a real diff, a
written file's content, a shell command's output — the way opencode's own terminal UI already
renders them, and wants each Live cell to start at half the grid's width instead of a third, so two
cells read clearly per row.

## What Changes

- A transcript's `Edit`/`MultiEdit` (Claude) and `edit` (opencode) tool calls render as a real diff:
  old/new line numbers, add/remove tinting, syntax highlighting — reusing the split/unified hunk
  renderer the pull request diff view already has, extracted so both can share it. Side-by-side when
  the cell is wide enough, unified when it is not.
- A `Write`/`write` tool call renders the file it wrote as numbered, highlighted content, collapsed
  behind an expand control once it is long — the same collapse pattern shell output already uses.
- A thinking block renders collapsed by default as one line naming its duration when that duration
  is derivable, expandable to the existing VS-319 markdown rendering.
- This is one rendering change in the transcript component every one of these already shares: Live,
  global Live, the worker page, the ticket page, the run page and the conductor chat's turn trace.
  Nothing else about those pages changes.
- The Live and global Live grids' default (never-resized) cell width becomes half the grid on both
  the `sm` and `xl` breakpoints. `sm` is already half today; only `xl` (currently a third) changes.
  The phone layout is unaffected — it already shows one cell per row. A previously-saved explicit
  resize keeps working exactly as it does today.
- A payload shape the renderer does not recognise — an edit-type tool from a runtime not covered
  here, or missing fields — keeps rendering today's compact tool row. It never renders an empty or
  broken card, and no runtime payload text is ever interpreted as HTML.

## Capabilities

### New Capabilities

- `run-transcripts/edit-rendering`: how an edit-type tool call (a Claude `Edit`/`MultiEdit`, an
  opencode `edit`, or a runtime's `write`-style tool) renders in any transcript — a diff or written
  content, the split/unified choice, syntax highlighting, collapsing a long written file, and the
  compact-row fallback for anything unrecognised.
- `run-transcripts/thinking-collapse`: how a thinking block renders collapsed with its duration when
  derivable, and expands to the existing markdown rendering.

### Modified Capabilities

- `workspace-navigation/live-floor`: the equal slot a never-resized Live cell occupies changes on the
  `xl` breakpoint from a third of the grid to half.

## Impact

- `packages/ui/src/lib/transcript.ts` and `packages/ui/src/components/Transcript.tsx` — the shared
  block model and renderer every listed surface uses.
- `packages/ui/src/routes/project/PullRequestDiff.tsx` — its `UnifiedHunk`/`SplitHunk` rendering is
  extracted so the transcript renderer can reuse it without duplicating it.
- `packages/render` — a new pure function turning an edit tool's before/after text into the same
  `DiffHunk[]` shape `@weave-ai/render`'s `parseUnifiedDiff` already produces, so one hunk renderer
  serves both a real unified diff and a synthesised one.
- `packages/ui/src/lib/liveCellSize.ts` and `packages/ui/src/routes/Live.tsx` /
  `packages/ui/src/routes/GlobalLive.tsx` — the never-resized default becomes breakpoint-aware
  instead of a single constant.
- No runtime adapter, no `run_events` schema, and no server-side code changes. Everything is derived
  from payloads already recorded.
