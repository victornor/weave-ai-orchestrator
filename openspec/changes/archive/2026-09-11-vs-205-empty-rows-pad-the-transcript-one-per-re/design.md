## Context

See `proposal.md` - Why. Two independent, hand-maintained implementations turn `RunEvent[]` into
transcript rows: `packages/render/src/transcript.ts::runEventsToTranscript` (shared by
`ac_run_inspect`, `conductor attach`/`chat`, `conductor runs`) and `packages/ui/src/lib/transcript.ts`
(the web app's own, separate implementation — despite `packages/ui` already depending on
`@agent-conductor/render` for other things, its transcript builder was never switched over).
Unifying them is a real, separate refactor and out of scope here; this change fixes the same bug in
both, in parallel.

Root cause, from reading the adapters (`packages/runtimes/*/src/events.ts`) and the existing
recorded fixture `packages/runtimes/claude/fixtures/turn-tool-structured.jsonl`:

- **Claude** (`events.ts:132-157`), **Gemini** and **Cursor** normalise a shell tool call into
  `tool.call` + `tool.result` (rendered as one folded row today) *and* a third event,
  `command.executed`, carrying `stdout`/`stderr`/`isError` but never the command text. Rendered
  as its own row (both builders already had a `command.executed` case), it is the bare `$` / bare
  `shell` row from the ticket. Codex and OpenCode send the command in this event and never
  duplicate the pair — unaffected.
- **Claude** and **Gemini** can also emit a `tool.result`/`tool.denied` whose `id → name` lookup
  (a per-turn `Map`, `events.ts:47,117,144`) misses, most likely across a resumed session's fresh
  parser instance or `ac_run_inspect`'s own event window starting mid-turn. Both builders already
  had a fallback for this ("a result without its call"); its name defaulted to the bare literal
  `'tool'`.

Ticket scope explicitly excludes changing what runtimes emit — see `proposal.md` - Impact.

## Goals / Non-Goals

**Goals:**
- One row per tool call in both transcript builders, with no information a reader could see today
  becoming unavailable.
- Cover the mechanism generically (by event shape and id correlation), so Gemini and Cursor are
  fixed by the same change as Claude, without adapter-specific branching in the renderer.

**Non-Goals:**
- Unifying `packages/render`'s and `packages/ui`'s transcript builders into one implementation.
- Changing any runtime adapter's emitted events (explicit ticket scope).
- Fully eliminating the orphaned-`tool.result` case's root cause (a parser-level, per-turn id map) —
  that lives in the adapter and is out of scope; this change only makes the ingestion-layer fallback
  for it less bare.

## Decisions

**Merge `command.executed` into the existing row, rather than drop it.** The ticket asks to choose
and justify. Dropping outright would be correct only if the event were pure noise; it is not always
— when a run's window is missing the shell call's own `tool.result` (a resumed session, or
`ac_run_inspect`'s bounded window), `command.executed` is the only place that call's actual output
survives. So: look up the tool block by call id (already-open `pendingTools`/`openTools`, or a call
that already folded — a new `completedTools`/`closedTools` map, since the existing code deleted the
id on fold); if found, back-fill only the fields the row is missing (detail, duration, an
error status implied by `isError`/a non-zero exit code) and add no row. Only when no matching call
is in view at all does it render standalone — under the tool name the payload actually carries
(`tool`/`name`) rather than the hardcoded `'shell'` both builders used unconditionally — and even
then only if it carries a command or output; one with neither is genuinely contentless and is
dropped, matching the ticket's "removal is justified" condition.

**Give the orphaned `tool.result` a body preview instead of a bare fallback name.** Its payload
already carries a real result body even when its name doesn't resolve (confirmed against the
existing "orphan tool.result" test coverage in both builders). Rather than rendering just the bare
word `'tool'`, both builders now use a short preview of that body as the row's target/summary when
one isn't otherwise available. This is a generic, low-risk rendering fallback — not a fix for the
adapter's id-resolution gap, which stays open (see Non-Goals).

**Alternative considered and rejected: branch on runtime/tool name in the renderer** (e.g. "if
Claude and tool is Bash, ..."). Rejected because the ingestion layer should not need to know which
adapter produced an event — id-based correlation already does the job generically, and it is what
fixes Gemini and Cursor for free.

## Risks / Trade-offs

- [The orphaned-`tool.result` fallback is still imperfect — a body preview is better than a bare
  word but is not a resolved tool name] → Acceptable: the ticket's evidence for this path is not
  reproducible from any recorded fixture (see the render package test suite for what *is*
  fixture-driven), and a full fix would touch adapter-level id resolution, which is out of scope.
- [Keeping completed call ids around for the rest of a render pass, rather than deleting them on
  fold] → Bounded by a single run's tool-call count; no observed run holds enough calls for this to
  matter, and the map is discarded with the render call.

## Migration Plan

None. Pure rendering-layer change; no stored data, API or event shape changes. Ships as a normal
merge.
