# Chat work trace: show file tools as "Edit <file name>"

Tracker change for [VS-437](weave://tickets/VS-437). A `task` ticket, so this change carries tasks
only — `skip_specs: true`.

## Why

Captain, 2026-09-14: a trace row for a file tool prints the whole path, e.g.

```
Edit  /home/user/agent-conductor/workspace/.agent-conductor/runtimes/claude/projects/-home-v-…/memory/MEMORY.md
```

The directory prefix adds nothing a reader needs. The tool name plus the file's base name
(`Edit MEMORY.md`) is the whole useful line; the full path belongs on hover for the rare case
someone wants it.

## What changes

- **Display the base name for a file target.** The two web trace renderers — V1's
  `TranscriptLine` (`packages/ui/src/components/Transcript.tsx`), which is also what V2's
  WorkerFeed/Live tiles/run page render, and V2's `ToolRow` (`packages/ui/src/v2/ChatTrace.tsx`) —
  show `targetBaseName(target)` when the tool's target came from a filesystem path field.
- **The full path moves to the element's `title`**, so hovering a row still gives the whole path.
- **Only a path-field target is shortened.** The UI transcript builder already knows which input
  field produced the target, so it records that raw path on the block (`targetPath`); a command, a
  search pattern and a url have no `targetPath` and render exactly as they do today. This covers
  every file tool (Edit, Write, Read, MultiEdit, NotebookEdit, opencode's `edit`/`write`, …)
  without a name list that would drift.
- **The render package's `toolTarget` is not touched.** The TUI, `weave runs`, the run inspector
  and the worker-activity line keep the target they get today.
- **Edge cases:** a path ending in `/`, Windows `\` separators and a bare file name all resolve;
  an empty result falls back to the original target.
- **Tests:** the pure `targetBaseName` (absolute path, trailing separator, Windows separators, bare
  name, empty), and both renderers — an Edit on an absolute path shows only `MEMORY.md` with the
  full path in `title`, a Read and a Write do the same, and a Bash command is unchanged.

## Out of scope

- The trace animation (VS-433, which is editing `ChatTrace.tsx`): rebase onto it if it lands first
  and keep its streaming behaviour.
- Changing what any tool records, or the expanded edit/diff body (it keeps the full path).
- The TUI/CLI surface, which is not a web trace.
