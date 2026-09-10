## Why

Every real tool call in a worker's transcript is followed by a second, near-empty row — a bare `$`
in the web live view and the conductor chat's work trace, a bare `shell` or `tool` line in
`ac_run_inspect`'s raw output. Captain flagged this from a screenshot: "I often see these empty
pound sign lines. Where are these coming from?" It roughly doubles the apparent length of every
transcript and reads as broken.

## What Changes

Investigation (full detail in `design.md`) found two distinct causes, both upstream of rendering —
not something to fix by changing what a runtime adapter emits (out of scope; see Impact):

- **Claude, Gemini and Cursor** send a `command.executed` event on top of the normal
  `tool.call`/`tool.result` pair for every shell-type call (Bash, etc.), carrying the same
  stdout/stderr the pair already rendered, but never the command text. Rendered on its own it is
  the bare `$` / bare `shell` row. **Codex and OpenCode are unaffected** — their shell events carry
  the command and never duplicate the pair.
- **Claude and Gemini** can also emit an orphaned `tool.result` whose `name` never resolves (its
  `tool_use_id` was never registered on this side of a resumed session or a truncated inspection
  window), which currently falls back to the bare literal `"tool"`.

- Both shared transcript builders (`packages/render/src/transcript.ts`, used by `ac_run_inspect`,
  the TUI and the CLI; `packages/ui/src/lib/transcript.ts`, used by the web live view and the
  conductor chat's work trace) fold a `command.executed` event into the row its `tool.call`/
  `tool.result` pair already rendered — backfilling a missing result or duration, never opening a
  second row — and only render it standalone (under its real tool name, not a hardcoded `'shell'`)
  when no matching call is in view, which happens only if it also carries a command or output; a
  companion with neither is dropped as genuinely contentless.
- Both builders give an orphaned, name-unresolved `tool.result` a preview of its own result body as
  its row instead of a bare fallback word, since it still carries real content even when it can't
  be attributed to a name.
- No behavior visible to a reader is lost: everything a dropped or merged companion event carried
  (stdout, stderr, exit code, duration) ends up on the one row that remains, or the row is dropped
  only when the event truly carried nothing new.

## Capabilities

### New Capabilities
(none)

### Modified Capabilities
- `worker-supervision/run-inspection`: "The inspection returns a compact, redacted transcript of
  the run" now guarantees a tool call's companion events (a runtime's duplicate result/completion
  event for the same call) fold into that call's one line rather than appearing as a second,
  near-empty line.
- `conductor-chat/turn-work-trace`: the expanded trace's "same transcript presentation the live
  view and the run page use" now explicitly excludes a bare, contentless row per tool call as part
  of that shared presentation.

## Impact

- `packages/render/src/transcript.ts` (shared by `ac_run_inspect`, `conductor attach`/`chat`, the
  CLI's `conductor runs`) and `packages/ui/src/lib/transcript.ts` (the web app's own, separately
  maintained implementation — used by the live view, the run/ticket/worker pages and the
  conductor-chat work trace). No runtime adapter (`packages/runtimes/*`) changes: the ticket's own
  scope excludes changing what runtimes emit, and the duplicate/orphaned events they send are a
  reasonable thing for an ingestion layer to absorb.
- No API, schema or migration changes. No change to `RunEvent` shapes stored in `run_events`.
