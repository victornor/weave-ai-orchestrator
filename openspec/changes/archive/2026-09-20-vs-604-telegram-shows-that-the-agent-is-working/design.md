## Context

VS-595 built the runtime-neutral live model (`liveTurn`, ephemeral `run.delta`, `GET /runs/:id/live`) and
VS-602 wired it into every web surface. Both briefed the channel slice and left it to this ticket
(archive `2026-09-20-vs-602-.../design.md`, audit row #15 and §5). Today `packages/channels/telegram/src/index.ts:224`
sends one `sendChatAction typing` per inbound message and then nothing until the run's single outbound answer.
This change adds the optional channel progress hook, the daemon driver, and Telegram's use of it.

Nothing here changes how a run, a thread or a thread message is stored, and nothing here depends on
VS-599/600/601 beyond what already merged: the daemon reports whatever live state exists, and a runtime that
reports whole steps only is said so in words.

## 1. The driver — what ChannelManager listens to

`ChannelManager` already subscribes to the workspace bus (`channels.ts:203-209`). It additionally handles the
ephemeral `worker.activity` frame, which VS-602 enriched with the live state.

Why `worker.activity` rather than re-deriving from `run.event`/`run.delta`:

| | `worker.activity` (chosen) | `run.event` / `run.delta` |
|---|---|---|
| live state | already computed by `createWorkerActivityService` with `liveTurn`, carrying `state`, `label`, `since`, `toolCount`, `turnMs`, `sinceLastMs`, `wholeStepsOnly` | would need a second per-run event buffer and partial accumulator inside the channel manager |
| agent resolution | frame carries `agentId` (and `ticketId`) | must query `runs` by the run id on every frame |
| cadence | the service already coalesces to ≤ one frame per worker per 2 s (`ACTIVITY_PUSH_MS`) | raw event rate |
| end signal | `finish()` broadcasts a frame with `live: null` | needs `run.finished` plus its own lifecycle bookkeeping |

So the driver is: on a `worker.activity` frame whose `live` is non-null, resolve the channel progress targets
for that run and drive them; on a frame whose `live` is null, end the turn's progress. The daemon's own
coalescing guard (below) keeps the "at most every 2 s" contract explicit and testable by emitting frames
directly, rather than relying on the activity service's throttle.

**Trade-off, stated:** the seconds in the message only advance when a new state arrives (the next tool, the
model starting to write). During a long silent stretch the placeholder's elapsed count stands still, but the
Telegram `typing` action keeps refreshing on the adapter's own timer, so the turn still reads as alive. A
per-second re-edit was rejected: it multiplies external API calls to show a number that changes anyway at the
next state.

### Resolving the run to its threads

A run is bound to channel threads two ways, and both are used:

- the thread's `agentId` is the run's agent — the ordinary case for the weaver's own primary Telegram thread;
- the thread is bound to the run's ticket (`/talk <ticket>`) — its `agentId` stays the conductor, but the
  human is watching the *worker* that the run belongs to, so a progress message that never moved for a
  `/talk` thread would be the exact silence this ticket removes.

`threads.list({agentId})` and, when the run has a ticket, `threads.list({ticketId})` give the candidates
(planner-owned threads are already excluded there, and planner threads are `web`-kind anyway). Each thread's
channel kind is read from `channels.id`, and only kinds whose running adapter implements `progress` are
kept. Targets are deduplicated and resolved once at `start`, so a mid-turn binding change is picked up by the
next turn rather than by flickering messages.

### Lifecycle and coalescing

Per agent, while live:

- first frame with `live` → resolve targets; if none, do nothing and remember nothing (a worker with no bound
  thread costs one indexed read per frame, which the daemon already does far more of). If there are targets,
  call `progress('start')` on each with the rendered text.
- later frames → call `progress('update')` only when `now - lastUpdateAt >= PROGRESS_UPDATE_MS` (2 s) **and**
  the rendered text changed; otherwise the frame is dropped. This makes the coalescing the manager's own
  contract, not an incidental property of the activity service.
- a frame with `live: null` → call `progress('end')` on each target, drop the state, and clear the target
  cache.

Every call is wrapped: `Promise.resolve(adapter.progress(p)).catch(log)`. A channel without `progress`, or
one whose `progress` throws, never reaches the run.

## 2. The contract

`packages/channel-sdk/src/index.ts`:

```ts
export interface ChannelProgress {
  threadExternalId: string;
  phase: 'start' | 'update' | 'end';
  text?: string;
}
export interface ChannelAdapter {
  readonly kind: string; readonly capabilities: ChannelCapabilities;
  configSchema(): JsonSchema;
  validateConfig(config: unknown): { ok: true } | { ok: false; errors: string[] };
  start(ctx: ChannelContext): Promise<RunningChannel>;
  send(msg: OutboundMessage): Promise<SendResult>;
  /** Optional (VS-604): show that a turn is live. Absent means the channel has no progress affordance. */
  progress?(p: ChannelProgress): void | Promise<void>;
}
```

Additive and optional: no existing adapter signature changes, and `channels-contract.test.ts` gains a case
that a minimal adapter without `progress` still satisfies the contract (and that `web` and `cli` define none).

## 3. The text — generic state only

Telegram is an external service: what is sent is published and may be cached. `liveTurnLine` (`liveTurn.ts:91`)
cannot be sent verbatim, because for a running tool its label is `Running <name> <target>` and the target is a
command (`Running bash sleep 3; ls`) or a path. The ticket's rule is explicit: generic state only, never a
command, file path, tool argument or streamed model text.

So `packages/render` gains a second pure formatter beside `liveTurnLine`:

```ts
export function progressLine(t: Pick<LiveTurn, 'state' | 'stateMs' | 'toolCount' | 'wholeStepsOnly'>): string
```

It maps `state` to a fixed generic word — `tool` → `Working`, `waiting` → `Waiting for the model`,
`streaming` → `Writing`, `thinking` → `Thinking`, `starting` → `Starting the turn` — and appends only
`clock(stateMs)`, the tool-call count and `whole steps only`. It reads the *state*, never `label`, so no part
of a tool call or model output can reach the string even if a label grows a new field. The `tool` case with a
tool count is exactly the `Working · 12 s · 5 tool calls` the ticket names.

The manager builds it from the `worker.activity` live fields: `stateMs = Date.now() - Date.parse(since)`,
`toolCount`, `wholeStepsOnly`, `state`. `turnMs` is available too but unused, so the line reads as the time in
the current state, matching the web row's primary number. Golden tests pin each state and an explicit test
pins that a tool state's text contains neither the tool name nor its target.

## 4. Telegram

`packages/channels/telegram` implements `progress`. State lives on the running channel (cleared on `stop`),
keyed by chat id, so a restarted channel starts clean.

- **start** — begin a typing keep-alive loop (a recursive `sleep` of `TYPING_REFRESH_MS = 4000`, safely
  inside Telegram's ~5 s expiry; the existing injected `sleep` is reused, so tests control it), then send one
  plain-text placeholder with `sendMessage` and store its `message_id`. If that send fails, log it and carry on
  with typing only: a failed initial send is not retried, so an outage does not turn into a message every 2 s.
- **update** — the typing loop already refreshes the action. If the text changed and
  `now >= max(lastEditAt + EDIT_MIN_MS (3000), notBefore)`, `editMessageText` the placeholder. A `MappedError`
  with `retryAfterSec` (HTTP 429) sets `notBefore = now + retryAfterSec * 1000` and keeps the newest pending
  text; the next allowed edit carries it. Any other failure is logged. Failures never throw.
- **end** — stop the typing loop. With a placeholder, mark the turn ended and arm a deferred delete at
  `PROGRESS_DELETE_AFTER_MS = 30_000`; the answer path below cancels it. Without one, drop the entry.
- **the answer is a new message** — Telegram raises no push notification or sound for an edited message, so
  `send(msg)` never edits. If a placeholder is live it is taken out of play when the send starts (typing and
  timers stop, later `progress` for that turn ignored), the answer is delivered through the normal `buildCalls`
  path — a new message, parse-error fallback unchanged — and the placeholder is then removed with
  `deleteMessage`, best effort. A failed (retryable) delivery leaves the placeholder in place, so the retry's
  own send removes it. This holds for every answer shape: a single text message, a card, an attachment, a
  split message. The emptied progress entry is kept briefly as a tombstone (30 s) so a late update cannot open
  a second placeholder.
- **clients** — `TelegramClient` gains thin `editMessageText` and `deleteMessage` wrappers over `call`, so the
  existing fake-`fetchImpl` tests cover them with no new transport.

After a turn is consumed or ended its entry is inert: a late `update` or `end` for it does nothing, so
progress can never overwrite the delivered answer.

## 5. Channels that do not do progress

| Channel | Progress? | Why |
|---|---|---|
| `telegram` | yes | this change |
| `web` | no | the web app already renders the live row from `worker.activity`/`run.delta` (VS-602); the adapter's `send` is the in-product thread, not an external transport |
| `cli` | no | a no-op transport: `send` reports delivered and the TUI pulls thread messages over HTTP (audit row #14) |

Surfaces (tmux/herdr/hyprland/headless) are not channels and take no part. Neither `web` nor `cli` gets a
stub `progress`, so the daemon's "adapter without `progress`" path is exercised in production, not only in a
test.

## 6. Tests and evidence

- `packages/render`: golden tests for `progressLine` in every state; a test that a `tool` state's text names
  no tool and no target.
- `packages/channel-sdk/test/channels-contract.test.ts`: a minimal adapter without `progress` is valid;
  `web` and `cli` define none.
- `packages/server/test/channels.test.ts` (fake adapters, real SQLite as today): `start` once, updates
  coalesced to one per 2 s, `end` on the frame with `live: null`; a run with no bound thread calls nothing; an
  adapter without `progress` is skipped; a `progress` that throws leaves drain and outbound delivery intact.
- `packages/channels/telegram/test/adapter.test.ts` (fake Bot API): typing refreshed inside the 5 s expiry;
  one placeholder, edits rate-limited to ~3 s; a 429 with `retry_after` reschedules and does not fail;
  `start`/`update`/`end`; the answer delivered with `sendMessage` and never `editMessageText`, followed by the
  placeholder's deletion; no answer deletes it; a late update after the answer is ignored; every progress
  failure is swallowed.
- **Evidence:** a Telegram transcript captured from the fake API (the ordered `sendChatAction`/`sendMessage`/
  `editMessageText`/`deleteMessage` calls of one simulated turn, from typing through the edited progress
  message to the answer), attached to the ticket. One full suite at a time, `--maxWorkers=4`.

## 7. Risks

- **A progress message that outlives its turn.** Mitigated by the end-path delete, the 30 s grace, and the
  answer's own delete-after-send; after any of them the entry ignores late calls.
- **External publication.** The generic-only formatter (§3) is the guarantee; a test pins that no command,
  path or model text can appear.
- **A `/talk` thread owned by the conductor.** Matching by ticket as well as agent is what makes a worker's
  run visible there; it is additive and only adds targets, never removes the agent match.
- **Extra external calls.** Bounded: one placeholder send per turn, ≤ one edit per 3 s, typing every 4 s.
  All progress traffic is best-effort and off the run's critical path.
