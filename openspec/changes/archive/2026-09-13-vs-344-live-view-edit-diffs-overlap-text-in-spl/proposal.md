## Why

A Live cell renders a worker's edit as a diff (VS-324). Side by side it uses a `grid-cols-2` whose
rows are `whitespace-pre`, with no `min-w-0` and no per-column wrapping, so a line longer than its
column spills across the divider onto the other side — captain's overlapping text. The split is also
chosen by a `@min-[32rem]` container query, too narrow to read two code columns, so it switches to
side by side in cells that cannot hold it.

## What Changes

- **A split diff never overlaps.** In side-by-side rendering each side keeps its lines inside its own
  column: a long line wraps within the column, hanging under the code rather than under the
  line-number gutter, and no column can be forced wider than its track. Unified rendering inside a
  transcript cell wraps the same way.
- **The layout is chosen by real room.** The container-query threshold moves up from `32rem` to a
  width that actually fits two readable code columns at the diff's monospace size; below it the diff
  is one column. The choice stays per rendered instance, because a Live cell resizes by drag.
- **The shared renderer keeps both of its uses.** `UnifiedHunk` gains a wrap option so the
  pull-request diff view can keep its horizontal-scrolling unified layout, while the transcript's
  unified layout wraps; `SplitHunk` always wraps, so the same overlap is fixed in the pull-request
  side-by-side view instead of forking the renderer for one caller.
- **Tests** pin what jsdom can see: the split columns' no-overflow and wrap classes, the chosen
  container-query threshold, and the pull-request view's scrolling unified layout.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `run-transcripts/edit-rendering`: the side-by-side/unified choice is made only at a width that
  fits two readable code columns, and a side-by-side diff never lets a line cross its column.

## Impact

- `packages/ui/src/components/DiffHunks.tsx` — `SplitHunk`'s columns and rows wrap and carry the
  overflow guard; `UnifiedHunk` gains a `wrap` option.
- `packages/ui/src/components/Transcript.tsx` — `EditHunk`'s container-query threshold and its
  unified hunk.
- `packages/ui/src/routes/project/PullRequestDiff.tsx` — its unified hunk opts into horizontal
  scrolling; its side-by-side hunk wraps.
- Tests: `packages/ui/src/test/transcript.test.tsx` and
  `packages/ui/src/test/pullRequestDiff.test.tsx`.
- No daemon, HTTP, MCP, CLI, schema or dependency change. Scope is `packages/ui` only.
