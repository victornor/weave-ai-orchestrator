## Why

Today the Telegram adapter sends one `typing` chat action per inbound message and then nothing until the
run's single final answer, so a long turn looks dead in Telegram. VS-595/VS-602 gave every in-product
surface a runtime-neutral live turn (`liveTurn`/`liveTurnLine`, ephemeral `run.delta`); the channel
surfaces were split out, and this change is the Telegram slice. The daemon must tell a channel that a
turn is live, and Telegram must use the two affordances it has — its expiring `typing` action and one
message it edits in place — without ever publishing the agent's words or the run's tool commands to an
external service.

## What Changes

- **Channel contract.** `packages/channel-sdk` gains an optional `progress?(p: ChannelProgress)` on
  `ChannelAdapter`, with `ChannelProgress = { threadExternalId; phase: 'start' | 'update' | 'end'; text? }`.
  It is optional, so every existing channel compiles and runs unchanged; a channel-contract test pins that.
- **Daemon driver.** The workspace `ChannelManager` (`packages/server/src/channels.ts`) turns a live run
  into progress calls on the channel threads bound to it: resolve the run's agent (and its ticket) to
  those threads, `progress('start')` once, coalesced `progress('update')` at most every 2 s, `progress('end')`
  when the run finishes. A run with no bound channel thread, or a channel without `progress`, does nothing.
  Progress failures are logged and never fail a turn.
- **Generic progress text only.** The daemon sends external channels generic state — `Working · 12 s · 5 tool calls`,
  `Waiting for the model · 8 s` — derived from the live state's state word, elapsed seconds, tool-call count
  and whole-steps-only flag. It never sends `liveTurnLine`'s tool label verbatim, because that label carries
  the tool name and its target (a command or a path); streamed model text never leaves the run view.
- **Telegram.** `packages/channels/telegram` implements `progress`: keep the `typing` action refreshed for the
  length of a turn (it expires in ~5 s), send one placeholder message and edit it in place with
  `editMessageText` (rate-limited to ~3 s, honouring a 429 `retry_after` without failing the turn), deliver the
  final answer as a new message (an edit would raise no notification) and delete the placeholder after it, or
  delete the placeholder if no answer follows.
- **Channels that cannot do progress are listed.** `web` has its own in-product live row and the `cli`
  channel is a no-op transport; neither implements `progress`, and the plan says so rather than leaving it
  silently different.

## Capabilities

### New Capabilities
- `channel-progress`: the optional channel adapter `progress` hook and the daemon `ChannelManager` driver
  that resolves a live run to the channel threads bound to it and sends generic-state `start`/`update`/`end`
  progress, where a progress failure never affects the turn.
- `telegram-channel/progress`: Telegram's use of the hook — typing keep-alive, one edited placeholder
  message, rate limiting with `retry_after`, answer-as-new-message and cleanup.

### Modified Capabilities
(none — the adapter contract is additive and Telegram progress is new behaviour)

## Impact

- `packages/channel-sdk` (`ChannelProgress`, optional `progress?`), `packages/render` (a generic
  `progressLine` state formatter beside `liveTurnLine`), `packages/server/src/channels.ts` (the driver),
  `packages/channels/telegram` (`progress`, `TelegramClient.editMessageText`/`deleteMessage`).
- Tests: `packages/channel-sdk/test/channels-contract.test.ts`, `packages/server/test/channels.test.ts`,
  `packages/channels/telegram/test/adapter.test.ts`, `packages/render` golden tests.
- No route, no schema, no migration, no change to how a run or a thread message is stored. `docs/PLAN.md`
  and `docs/API.md` are unchanged unless a channel-contract sentence belongs there.
