## Why

Captain hit the 1M-token context limit with auto-compaction off; the runtime CLI compacted the
conversation itself. The live trace showed a `Compacting conversation…` row, but the composer banner
("anything you send now is queued") never appeared, because that banner and the `compacting_at`
session state are written only by our own out-of-band compaction path. The adapter-initiated
compaction therefore holds no session state, and the turn's own context-size observation can survive
it — leaving the automatic policy able to fire immediately afterwards on a number that is no longer
true (the same livelock shape VS-500 fixed, from the other direction).

## What Changes

- **Handle the runtime's compaction stream events in the run engine.** When a turn emits
  `session.compaction.started`, mark the active session compacting and broadcast the ephemeral
  `session.compaction` frame for that agent — the same state and frame the daemon path writes — so
  the composer banner appears and the dispatcher's compaction gate is consistent. When
  `session.compaction.completed` arrives, clear the mark and broadcast the closing frame so it
  disappears.
- **Consume the context-size observation for the adapter path too.** On an adapter compaction, do
  not leave the turn's pre-compaction `last_context_tokens` behind for the automatic policy. Record
  the runtime's reported post-compaction size when the boundary carries it, otherwise clear it, so
  the next automatic attempt can only come from a genuinely fresh observation.
- **Do not add a second origin column.** One `compacting_at` already names the invariant both paths
  need ("the session is mid-compaction; hold its wakes and show the banner"). The origin is carried
  in the emitted event/log for observability, not in separate session state.
- **Name detectability per runtime, and do not fake it.** Only Claude reports compaction on the turn
  stream; Codex, OpenCode, Cursor and Gemini emit nothing usable, so no banner is synthesised from a
  token-drop heuristic there.
- **Tests** for the adapter path in the engine (started → mark + frame; completed → clear + fresh
  accounting), plus the existing VS-454 UI coverage for the live row and marker.

No breaking changes.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `runtime-session-compaction`: adds adapter-initiated compaction to the same session state,
  notification and context-accounting contract the out-of-band path already follows, and states per
  runtime whether the adapter reports compaction.

## Impact

- `packages/core/src/runs/engine.ts` — observe `session.compaction.*` on the turn stream and drive
  the session state, the ephemeral frame and the context observation.
- `packages/core/src/sessions/index.ts` — a way for the engine to set/clear the compaction mark and
  record the post-compaction context size on completion.
- `packages/core/src/workers/index.ts` — unchanged behaviour; the shared session service remains the
  one writer of the compaction state.
- `packages/core/src/runs/dispatcher.ts` — unchanged; it already reads `compacting_at` and
  `last_context_tokens`.
- No UI change is required: the composer banner and the live trace row are already wired to the
  `session.compaction` frame and the `session.compaction.*` run events (VS-454).
- Tests: `packages/core` engine/session coverage for the adapter path.
- Per-runtime documentation of detectability lands in the change and the PR.
