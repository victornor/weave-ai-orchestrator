## Why

On Live, a working engineer's transcript currently lists every tool call as its own row, so a turn that reads ten files in a row shows `read read read glob read read`. Consecutive same-name calls should collapse to `Read ×N`, expandable to each invocation, so the cell is scannable without losing the per-call detail.

## What Changes

- **Consecutive identical tool names collapse to one row with a count.** Ten Reads in a row render as one `Read ×10` (or equivalent) row. A lone call stays a single row, with no `×1`.
- **Expanding the row lists each invocation** with the same path/args (and result body) each call shows today.
- **A different tool name starts a new group.** `read, glob, read` stays three groups. Order is preserved. A non-tool line (assistant text, phase, status) also splits a run.
- **Workspace Live and global Live share this.** Both already render through the same `LiveCell` → `RunTranscript` → `Transcript` stack; the collapse lives there so they cannot drift.
- **No daemon, API, TUI, or Telegram change.** Chat's finished-turn trace is out of scope as a product request; if the shared `Transcript` component is the one place to fix, other web surfaces that already use it inherit the same presentation (the existing turn-work-trace spec already requires matching the live view).

## Capabilities

### New Capabilities

- (none)

### Modified Capabilities

- `workspace-navigation/live-floor`: a Live cell's streamed transcript collapses consecutive identical tool names into a counted, expandable row.
- `workspace-navigation/global-live`: the same collapse applies on the global Live page, because it uses the same cell transcript.

## Impact

- `packages/ui/src/components/Transcript.tsx` — group consecutive same-name `type: 'tool'` blocks for display; collapsed head shows `Read ×N`; expand lists each call as today.
- `packages/ui/src/lib/transcript.ts` — only if grouping is easier as a pure helper next to `runEventsToTranscript`; event→block mapping itself does not change (a call still merges with its result).
- `packages/ui/src/test/transcript.test.tsx` (and/or a focused live-transcript test) — ten Reads collapse and expand; mixed `read, glob, read` stays three groups; a single Read is unchanged.
- Workspace Live (`Live.tsx`) and global Live (`GlobalLive.tsx`) pick this up with no route change: both already mount `LiveCell` → `RunTranscript` → `Transcript`.
- Ticket Activity, Run page, and an expanded conductor turn-trace inherit the same presentation if they keep using `Transcript`/`RunTranscript`. That is the "one fix" path, not extra scope.
- No daemon, schema, API, event, PLAN, TUI, or Telegram change. No new dependency.
