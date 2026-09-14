# V2 file-edit diffs get their own green/red tints

Tracker change for [VS-419](weave://tickets/VS-419). A `task` ticket, so this change carries
tasks only — `skip_specs: true`.

## Why

Every file-edit preview shares one renderer, `packages/ui/src/components/DiffHunks.tsx`, whose
`LINE_BG` tints an added line with `bg-done/10` and a removed one with `bg-failed/10` — the status
tokens. `.ac-diff-code .hljs-addition` in `packages/ui/src/index.css` colours addition text with
`--status-done` too.

V2's Mono theme deliberately makes `--status-done` greyscale (`#7c828b` dark, `#565a61` light) so
the done badge reads as a settled state, not as success-green. Diffs inherit that: in V2 an added
line is a wash of grey, and the red removal tint stays but at 10% it is barely legible. The
renderer is used by V2 chat traces, the Watch and Roles panes, run detail and the PR diff, so every
V2 diff loses the at-a-glance read the +/− markers alone cannot give.

## What changes

- **Four diff tokens, independent of the status palette:** `--diff-add-bg`, `--diff-remove-bg`,
  `--diff-add-fg`, `--diff-remove-fg`. Additions take a subtle green, removals a subtle red, in V1
  dark and light and in V2 (Mono) dark and light. Because they are separate tokens, Mono's
  `--status-done` stays grey and every existing status badge is untouched.
- **`packages/ui/src/index.css` declares the V1 values and maps them into Tailwind's `@theme inline`
  block** (`--color-diff-add-bg`, …), so `bg-diff-add-bg` / `text-diff-add-fg` resolve against
  whatever is in scope — the same mechanism the V1/V2 split already relies on.
- **`packages/ui/src/v2/v2.css` overrides the four tokens under `.v2-root` and
  `.v2-root[data-theme='light']`**, alongside the other Mono token overrides, so V2 diff tints are
  the same greens and reds in both themes and never the Mono grey.
- **The renderer and the highlight.js class use the new tokens:** `DiffHunks.tsx`'s `LINE_BG` for
  the unified and split views, `Transcript.tsx`'s `DiffBlock` (the raw-diff preview), and
  `.ac-diff-code .hljs-addition` in `index.css`. The +/− markers and the row layout do not change.
- **A regression test** renders a hunk with added, removed and context lines and asserts the added
  row carries the add token and the removed row the remove token — and neither carries `bg-done` or
  `bg-failed`.

## Out of scope

No other Mono colour changes, no diff layout change, and VS-413's expand-by-default behaviour is
left exactly as it landed. V1 values keep their current green/red hue and a comparable tint
strength, so V1 does not regress.
