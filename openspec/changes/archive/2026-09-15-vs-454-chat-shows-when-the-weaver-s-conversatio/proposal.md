# Chat shows when the weaver's conversation is being compacted

Tracker change for [VS-454](weave://tickets/VS-454). A `task` ticket, so this change carries tasks
only — `skip_specs: true`.

## Why

Captain, 2026-09-14 23:23Z: the weaver chat went silent for a long stretch and the context meter then
dropped to about 1% — the CLI had compacted the conversation on its own. Nothing in the chat said so,
so it looked like a stuck weaver. Compaction must be visible while it runs, and explained afterwards.

## What changes

- **A normalized compaction event.** Two new run-event types —
  `session.compaction.started` and `session.compaction.completed` — carrying an optional `trigger`
  (`auto` | `manual`) and, on completion, `preTokens` / `postTokens` / `droppedTokens` when the
  runtime reports them.
- **Claude is the runtime that reports it.** Verified from the installed CLI bundle
  (`claude 2.1.270`), not assumed: the stream emits a `system` / `status` message with
  `status: "compacting"` while compaction runs (the earlier signal, so the live state shows during
  the pause), and a `system` / `compact_boundary` message with
  `compact_metadata: { trigger, pre_tokens, post_tokens?, … }` once it finishes. The adapter maps
  the first to `started` and the second to `completed`.
- **opencode emits nothing, and that is the finding.** The adapter drives `opencode run --format
  json`, whose event loop forwards only `tool_use` / `step_start` / `step_finish` / `text` /
  `reasoning` / `error`; its `session.status` is `idle | retry | busy` (no compacting state), and the
  `session.next.compaction.*` / `session.compacted` events are the v2/TUI bus, never serialized by
  `run`. codex, cursor and gemini likewise have no signal. These adapters emit no compaction event.
- **Live state in the chat.** While a turn has a `started` without a matching `completed`, the V2
  live trace area shows an animated `Compacting conversation…` row in place of looking idle, themed
  with the existing dark / light / Mono tokens.
- **Persistent marker.** The finished turn's trace keeps a one-line `Conversation compacted` row,
  with `before → after` tokens when known.
- **Everywhere the trace renders.** The row lives in the shared transcript view-models (`render` and
  the UI's own builder), so the weaver chat, the Plan modal chat and worker feeds all get it.
- **Tests and evidence.** Adapter parsing tests against a captured-style `compact_boundary` /
  `status` line in the committed fixtures, transcript and V2 UI tests for both states, and rendered
  dark / light screenshots of the live state and the marker from a replayed event stream.

## Out of scope

- Running the real Claude or opencode CLI to capture a live stream; the agent-wide rule forbids it
  from a ticket. The Claude shapes are read from the installed 2.1.270 bundle and pinned in fixtures;
  the PR says plainly which was not verified live.
- Changing what `contextCompactionAt` / the context meter does (that stays anticipatory).
- The V1 chat surface (no new V1 work).