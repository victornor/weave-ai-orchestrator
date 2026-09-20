## 1. The contract and the generic text

- [x] 1.1 Add `ChannelProgress` and the optional `progress?(p: ChannelProgress): void | Promise<void>` to `ChannelAdapter` in `packages/channel-sdk/src/index.ts`; verify `packages/channel-sdk/test/channels-contract.test.ts` gains a case that a minimal adapter without `progress` is a valid adapter and that the `web` and `cli` adapters define none, and the test passes
- [x] 1.2 Add the pure `progressLine(t: Pick<LiveTurn, 'state' | 'stateMs' | 'toolCount' | 'wholeStepsOnly'>): string` to `packages/render/src/liveTurn.ts` mapping state to a fixed generic word (`tool` → `Working`) and appending only the clock, tool-call count and whole-steps-only notice; verify golden tests for every state plus a test that a `tool`-state line contains neither the tool name nor its target pass

## 2. The daemon driver

- [x] 2.1 In `packages/server/src/channels.ts`, handle the ephemeral `worker.activity` frame: resolve the threads bound to the frame's agent and ticket whose channel adapter implements `progress`, call `progress('start')` once, coalesced `progress('update')` at most once per 2 s with the `progressLine` text, and `progress('end')` when the frame's `live` is null; wrap every call so a missing or throwing `progress` is logged and never reaches the run
- [x] 2.2 Verify in `packages/server/test/channels.test.ts` with fake adapters over the real DB: `start` once, one `update` per 2 s window, `end` on `live: null`; a run with no bound thread makes no call; an adapter without `progress` is skipped; a `progress` that throws leaves `drain()` and outbound delivery intact

## 3. Telegram

- [x] 3.1 Add thin `editMessageText` and `deleteMessage` methods to `TelegramClient` (`packages/channels/telegram/src/api.ts`) over the existing `call`; verify the fake-`fetchImpl` tests drive them
- [x] 3.2 Implement `progress` on the Telegram adapter: a typing keep-alive loop at ~4 s while a turn is live, one placeholder `sendMessage` on `start` whose id is stored, and rate-limited `editMessageText` on `update` (~3 s, newest text winning, HTTP 429 `retry_after` setting `notBefore` without failing); verify with the fake Bot API that typing is refreshed inside its expiry, edits are coalesced, and a 429 reschedules
- [x] 3.3 Finish the Telegram progress lifecycle: `end` stops typing and defers deletion of an unconsumed placeholder (30 s grace), and `send` takes the live placeholder out of play so a late update is ignored; verify with the fake Bot API that no answer deletes the placeholder and that a progress failure never throws
- [x] 3.4 The answer is always a new message (Telegram raises no notification for an edit): `send` delivers it through the normal path — parse-error fallback unchanged — then deletes the placeholder best effort, for every answer shape; verify with the fake Bot API that the answer is delivered with `sendMessage` and never `editMessageText`, that a card/attachment answer still deletes the placeholder, that a retryable failure keeps it, and that a late update after the answer does nothing

## 4. Evidence and closing

- [x] 4.1 Capture a Telegram transcript from the fake API — the ordered `sendChatAction`/`sendMessage`/`editMessageText`/`deleteMessage` calls of one simulated turn from typing through the edited progress message to `sendMessage(answer)` and `deleteMessage(placeholder)` — and attach it to the ticket
- [x] 4.2 Run `pnpm lint && pnpm typecheck` and one full `pnpm test` at a time with `--maxWorkers=4`; verify green and paste both suite blocks (core/server and UI) verbatim in the report