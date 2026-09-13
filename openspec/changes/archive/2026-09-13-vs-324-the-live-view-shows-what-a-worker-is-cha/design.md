## Context

Every transcript surface (Live, global Live, worker page, ticket page, run page, chat's turn trace)
renders through one shared pipeline: `packages/ui/src/lib/transcript.ts`'s `runEventsToTranscript`
turns `RunEvent[]` into `TranscriptBlock[]`, and `packages/ui/src/components/Transcript.tsx` renders
them (`RunTranscript` and `TurnTrace` both wrap it). Fixing that one pipeline reaches every surface
the proposal lists; no route-specific work is needed.

Verified directly from the runtime adapters (`packages/runtimes/claude/src/events.ts`,
`packages/runtimes/opencode/src/events.ts` — read, not guessed, per this workspace's own convention
of writing patterns from real bytes):

- **`tool.call`'s `input` is the only place edit data lives.** Claude's `input` is the tool_use
  block's raw input (`file_path`/`old_string`/`new_string` for `Edit`, `edits[]` of the same shape
  for `MultiEdit`, `content` for `Write`); opencode's is `state.input` on the `tool_use` part
  (`filePath`/`oldString`/`newString` for `edit`, `content` for `write`).
- **`tool.result` never carries it.** Its `content` is a confirmation string ("file updated") or a
  small preview, not the diff or the full written content.
- **`file.changed` never carries it either.** Both adapters emit `{ path, tool, id/toolUseId }` only
  — no `diff`, no `patch`, no hunks, contrary to what the ticket's own research note suggested might
  be there. This is worth confirming again before writing tests, since it is the kind of claim this
  workspace's conventions say to verify against real bytes rather than trust.
- **No runtime reports a thinking block's duration.** It must be derived from event timestamps: the
  gap between a thinking event's `ts` and the next event's `ts`.
- **Existing committed fixtures have no Edit/Write call to copy.**
  `packages/runtimes/{claude,opencode}/fixtures/*.jsonl` cover `Bash`/`StructuredOutput`
  only. New fixtures (or hand-built `RunEvent[]` matching the field names above, cited to the
  adapter source) are needed for edit-rendering tests, and should be recorded from an actual
  session's `tool.call` payload where practical rather than typed from memory.
- **`packages/render/src/transcript.ts` is a second, independent transcript builder** (PLAN §21.3
  calls it "the single implementation of transcript semantics", used by the TUI and
  `weave_run_inspect`'s flattened lines). It already diverges from the web app's own
  `packages/ui/src/lib/transcript.ts` in block shape and field names, and this change does not
  reconcile them — the TUI renders plain text lines, not a rich diff view, and unifying the two is a
  separate, larger change nobody has asked for. Noted as a landmine, not fixed here.
- **The PR diff view's `UnifiedHunk`/`SplitHunk`** operate on `DiffHunk` from
  `packages/render/src/diff.ts`'s `parseUnifiedDiff`, which parses real `git diff` text. An edit
  tool's `old_string`/`new_string` is not diff text — there is no `@@ … @@` header, no base-file line
  offset. A synthesised hunk is needed to feed the same renderer.
- **`packages/ui/src/lib/liveCellSize.ts`'s `DEFAULT_SIZE` is a flat constant** (`{ cols:
  GRANULARITY, rows: GRANULARITY }`) applied at every breakpoint. It reads as "half the grid" today
  only because `sm`'s total column count happens to be `2 × GRANULARITY` — `xl`'s is `3 ×
  GRANULARITY`, which is why `xl` shows three cells per row today. `LiveCell` (shared by `Live.tsx`
  and `GlobalLive.tsx`) already receives a `desktop` prop that is exactly `minSm` (true at both `sm`
  and `xl`, false only on the one-column phone layout) — that is the boolean this change needs, no
  new prop required.

## Goals / Non-Goals

**Goals:**
- One rendering change in the shared transcript pipeline, reaching every listed surface.
- Reuse the PR diff view's hunk renderer rather than building a second one.
- Keep the default-size fix confined to `liveCellSize.ts`'s default calculation — the resize
  granularity, drag mechanics and persistence format are unchanged.

**Non-Goals:**
- Reconciling `packages/render`'s transcript builder with the web app's — out of scope, flagged
  above.
- True file-line-accurate line numbers for a synthesised edit diff — see Decisions.
- Any change to what a runtime adapter emits, or to the `run_events` schema.
- The PR review page's own behaviour (explicitly out of scope in the ticket).

## Decisions

**A new pure function turns an edit's before/after text into `DiffHunk[]`, reusing the PR diff
view's line-diff shape rather than inventing a second one.** `packages/render` has no diffing
algorithm today — `parseUnifiedDiff` only parses already-diffed text. This change adds a small
line-level diff (an LCS-based algorithm; no new dependency, since the whole-file-diff case
`parseUnifiedDiff` already handles is the only place a heavier algorithm would matter, and an edit
snippet is small) that produces the same `DiffHunk`/`DiffLine` shapes `parseUnifiedDiff` does, so
`UnifiedHunk`/`SplitHunk` — extracted out of `PullRequestDiff.tsx` into a shared location — render
both without knowing which one produced the hunk.

**A synthesised hunk's line numbers count from 1 within the shown snippet, not the file's true
line numbers.** An edit tool's payload carries the changed text, not its offset in the file, and
deriving the real offset would mean reading the file — out of scope, and impossible for a file a
later event has already changed again. The alternative (omitting line numbers for synthesised
hunks) would make a tool-call diff visually inconsistent with a PR diff for no benefit; relative
numbering keeps the same renderer and reads sensibly for a snippet. This is called out explicitly
so it is not mistaken for a bug during review.

**`MultiEdit`/multi-edit payloads render one hunk per edit, independently, in call order** — not
reconstructed against each other or against the file. Each edit in the array already carries its own
complete old/new snippet; there is no cheap way to tell whether two edits in the same call overlap
without the file, and the ticket does not ask for that.

**A `Write`/`write` call is content, not a diff** — there is no "before" to diff against. It renders
through a separate, simpler path: numbered, highlighted lines, collapsed past a line-count threshold
the same way long command output already collapses.

**Side-by-side vs. unified is decided per rendered instance via a CSS container query, not a
JS-measured width.** A Live cell's width varies continuously by drag, not by viewport breakpoint, and
jsdom cannot report real layout geometry — this workspace's own convention (see project knowledge)
is to keep a harness's inability to measure geometry from deciding product behaviour: test the pure
diff-construction logic, verify the responsive choice visually. The PR diff view keeps its own
existing (device-preference + phone-forces-unified) behaviour unchanged, since it is explicitly out
of scope; the transcript's own instances get the container query independently.

**`liveCellSize.ts`'s default becomes a function of `desktop` and `colsMax`, not a flat constant.**
`defaultSize(desktop, colsMax)` returns `{ cols: desktop ? colsMax / 2 : colsMax, rows: GRANULARITY
}`. Since `colsMax` is `8` at `sm` and `12` at `xl` (both `desktop === true`) and `4` at phone
(`desktop === false`), this gives half-width at `sm` and `xl` and full-width at phone without any
new per-breakpoint branching, and without touching the resize-granularity math (`clampSize`,
`snapSize`) at all. `isDefaultSize`, `sizeOf` and `writeLiveCellSizes` take the same two extra
parameters so "is this the default" stays correct at whichever breakpoint asks. This is why no
migration is needed for sizes saved before this change: the old default (`{cols: GRANULARITY,
rows: GRANULARITY}` = 4×4) was already the value `isDefaultSize` stripped from storage at write time
on every breakpoint, so no explicit saved entry can equal it — every saved entry today is already a
genuine deliberate resize, and stays exactly as meaningful under the new default.

**Thinking-block duration is derived, not requested.** `runEventsToTranscript` computes it as the
next event's `ts` minus the thinking event's `ts` when both parse and the delta is non-negative;
otherwise the block still collapses, just without a duration line, matching how a `phase` block
already omits duration when it lacks one.

## Risks / Trade-offs

- **[Risk] A hand-rolled line diff is a new piece of non-trivial logic.** → Mitigation: keep it
  small (line-level LCS over the two strings' lines, nothing character-level, no move detection) and
  golden-test it in `packages/render` the way the rest of that package is tested, against payload
  shapes cited to the adapter source.
- **[Risk] Relative line numbers on a synthesised diff could read as a bug to a future maintainer.**
  → Mitigation: documented above and in the code comment at the call site.
- **[Risk] `packages/render`'s own transcript builder staying unreconciled means a future change to
  edit rendering has two places to update if the TUI ever wants the richer view.** → Mitigation:
  noted in the project knowledge base so it surfaces if that ever comes up; not fixed here since
  nothing asks for it.

## Migration Plan

No data migration. Session-stored Live cell sizes are read exactly as they are today;
`isDefaultSize`'s new breakpoint-aware comparison changes nothing about entries already saved
(see Decisions). Deploys as an ordinary PR merge; no flag, no staged rollout.
