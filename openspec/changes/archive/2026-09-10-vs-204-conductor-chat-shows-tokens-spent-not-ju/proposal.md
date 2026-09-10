## Why

The conductor chat's per-turn work-trace line ("what I did · 3 tool calls · 2m11s") and each
message's timestamp tell captain how long a turn took, but not what it cost. Tokens are already
recorded on every run; they are just not surfaced in the two places captain actually reads them
while triaging the chat.

## What Changes

- The work-trace summary line under a conductor reply (and the standalone row for a turn that said
  nothing) gains the turn's tokens spent, in the existing `18.4k tok` house format, and — only when
  a genuine figure is obtainable — how full the model's context window was for that turn, in the
  same size-over-window form the header context meter already uses (`82k/200k ctx`).
- Each message gains its turn's token count next to its timestamp, unobtrusively.
- `RunTrace` (`packages/shared`), the aggregate the chat's history already fetches for the "what I
  did" line, gains the run's `model` and `usage` — both already stored per run, so this is exposing
  existing columns through an existing aggregate, not new collection.
- A turn from a runtime that reports no usage (`usageReporting: 'none'`, e.g. Cursor today) renders
  with the token and context figures simply absent — no `0 tok`, no `NaN`, no dangling `·`.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `conductor-chat/turn-work-trace`: the collapsed work-trace line and the daemon's run-trace
  aggregate both gain tokens (and, when obtainable, context-window usage); a message gains its
  turn's token count next to its timestamp.

## Impact

- `packages/shared/src/types.ts` — `RunTrace` gains `model` and `usage`.
- `packages/core/src/runs/index.ts` — `RunsService.traces()` selects and returns the two new
  fields; no new query, no new table.
- `packages/ui/src/components/TurnTrace.tsx` — renders tokens and, when a context window is
  resolvable, the context fraction.
- `packages/ui/src/routes/Chat.tsx` — passes the already-fetched runtime model catalog down so a
  historical turn's own model can be resolved against its own context window, and passes the
  matching trace's usage to `ChatMessage` for the per-message token count.
- `docs/API.md` — the one-line description of `GET /runs/traces` gains the two new fields.
- No runtime/adapter change, no new migration, no new database column: `runs.model` and
  `runs.usage_json` already exist and are populated for every run.
