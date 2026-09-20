## Context

VS-595 built the runtime-neutral live model and wired three web surfaces. This change makes the rest of the web interfaces consume it. The rule from the ticket: reuse `liveTurn`, do not fork it; a live turn never renders an empty or bare "working"; the weaver's streamed text is the run view and never the delivery channel; partial frames use the same secret redaction as persisted events. Nothing here changes how runs are stored, and nothing here depends on VS-599/600/601 — those make individual runtimes emit partials; this change consumes whatever partials exist and says "whole steps only" in words where there are none.

**Scope (weaver, 2026-09-20):** slice 4 (TUI and CLI) is **VS-603** and slice 5 (channel progress and Telegram) is **VS-604**, each blocked on this ticket and reusing `liveTurnLine`. This change keeps the web slices 1-3 and the web evidence; §1 (the audit), §4 and §5 stay as the two follow-ups' brief.

## 1. Audit — every interface that shows or talks to an agent

Read from the code at this branch (VS-595 merge `9bc2ebc5b8dd`). "Live source" is what the surface can feed a live row from.

| # | Interface | Where | Renders during a live turn today | Live source | Change |
|---|---|---|---|---|---|
| 1 | Weaver chat | `packages/ui/src/v2/ChatConversation.tsx` `LiveSection` (`:102-149`) | Pulsing dot + literal **"working"** / "starting…" (`:133-137`), then raw trace. Already calls `useRunEventStream` (`:176`) but discards `partials`/`partialSince`. | has `events`+`partials`; `runtimeId` not passed | render `LiveActivity` (+`LivePartials`) in `LiveSection`; forward `runtimeId` from `ChatPage` (`:347`) |
| 1a | Chat turn trace | `packages/ui/src/v2/ChatTrace.tsx` | transcript rows only | gets `events` as a prop | no change beyond 1 |
| 1b | Global chat panes | `packages/ui/src/v2/chats/ChatsPage.tsx` | N panes reusing 1; only the focused pane holds the stream (`:310-311`) | via 1 | inherits 1 |
| 2 | Planner / plan tab | `packages/ui/src/v2/PlanTab.tsx` (`:183-206`) | renders `ChatConversation`; same literal "working" | `live.id`; `plannerRuntimeId` (`:112`) | inherits 1 |
| 3 | Worker page, ticket-bound | `packages/ui/src/v2/WorkerPage.tsx` → `WorkerFeed.tsx` → `RunTranscript` | `LiveActivity` + `LivePartials` already | `useWorkerRun` (`:154-169`) | none — already live |
| 3a | Role session, ticketless | `WorkerPage.tsx` `SessionThreadFeed` (`:78-106`) | plain `<ol>` of messages; no live state, opens no stream | `detail.data` has the session agent and its runs | add live row + stream for the session's active run |
| 4 | Roles page, expanded row | `packages/ui/src/v2/RolesPage.tsx` `WorkerRow` (`:408-477`) | `WorkerFeed` when expanded; collapsed row status text only | `useWorkerRun` (`:422`) | collapsed row: state word + elapsed rather than a bare status |
| 4a | Project overview role chats | `packages/ui/src/v2/project/RoleChatsSection.tsx` | controls only; opens `/workers/:id` | — | no transcript here; the worker page it opens is live (#3) |
| 5 | Work board cards | `packages/ui/src/v2/work/Work.tsx` (`:181-212`, `:705`) | `LiveActivityLine` from `worker.activity`; fallback `{label:'Working', since:null}` | `useWorkerActivity` (coalesced, one frame/worker) | enrich the frame with `liveTurn` fields; never bare "Working" |
| 6 | Live page | `packages/ui/src/v2/LivePage.tsx` `LiveCard` (`:118-173`) | `WorkerFeed` → `LiveActivity` already | `useWorkerRun` | none — already live |
| 7 | Ticket page | `packages/ui/src/v2/ticket/Ticket.tsx` header (`:238`) + `RunTurn` (`:732-768`) | header `LiveActivityLine`; turn `LiveActivity` already | `worker.activity` + `useRunEventStream` | header inherits #5 |
| 8 | Decision card (V2) | `packages/ui/src/v2/DecisionCard.tsx` (`:150-177`, `:522`) | "Revision in progress · Ns ago" (plain `ago()`); Watch opens `WorkerFeed` | `askedBy` + `askedInRunId` | revision row uses `liveTurn` state + elapsed |
| 8a | Decision card (V1) | `packages/ui/src/components/DecisionCard.tsx` | status glyph + review lines only | `askedBy`/`ws` present | add the live row where the decision names a run |
| 9 | Runs list | `packages/ui/src/v2/RunsPage.tsx` (`:287`, `:312`) | status glyph with pulse only | `r.id` per row | live line for active rows |
| 10 | TUI `weave attach` | `packages/tui/src/apps/Attach.tsx` | event transcript only; workspace stream handler drops `run.delta`/`worker.activity` (`:94-106`); never reads `/runs/:id/live` | has `events`, agent id; generic SSE parser keeps frame types (`cli/src/api.ts:252-262`) | consume `run.delta` + `/runs/:id/live`; live row via `liveTurn`+`clock` |
| 11 | TUI `weave chat` | `packages/tui/src/apps/Chat.tsx` (`:144-150`) | dim `weaver is working…` / `starting…` | `events`; workspace stream (`:117-139`) | add `run.delta`; live row |
| 12 | TUI `weave top` | `packages/tui/src/apps/Top.tsx` (`:82-92`) | glyph, status label; discards the `activity` field `/workers` already returns | `worker.activity` via refetch | show activity label + elapsed |
| 13 | CLI follow `weave runs tail` | `packages/cli/src/commands/runs.ts` (`:89-114`) | completed transcript blocks only | per-run SSE; can also subscribe to workspace `/events` | print the live activity line from `run.delta` |
| 14 | CLI channel adapter | `packages/channels/cli/src/index.ts` | no-op transport: `send` returns delivered, "The TUI pulls thread messages over HTTP" | — | nothing to render; the CLI-facing surfaces it feeds are #10-13 (stated, not left silent) |
| 15 | Telegram | `packages/channels/telegram/src/index.ts` (`:224`) | one `sendChatAction typing` per inbound; silence until the final answer | needs a daemon-fed progress hook | typing keep-alive + one edited progress message (slice 5) |
| 16 | Surfaces: tmux / herdr / hyprland | `packages/surfaces/{tmux,herdr,hyprland}` | each launches `ctx.attachCommand` → `weave attach` (`presenter/src/index.ts:86`) | inherits #10 | none of their own; live once #10 lands |
| 17 | Surface: headless | `packages/surfaces/headless/src/index.ts:6-25` | renders no view at all (monitoring is the web app or ad-hoc `weave attach`) | — | stated in the plan; nothing to change |

**Conclusion.** The gaps are: (a) the web conversations (#1/#2) and role sessions (#3a); (b) the coalesced activity line the board/header/decision/runs surfaces use (#5/#7/#8/#9), which must carry the same states; (c) the whole TUI and the CLI follow output (#10-13); (d) Telegram (#15). Surfaces #16/#17 need no adapter change. The CLI channel adapter (#14) is a no-op transport and is stated rather than changed.

## 2. The shared model — one vocabulary everywhere

`liveTurn(events, partials, now, opts)` already returns `{state, label, stateMs, turnMs, toolCount, sinceLastMs, running[], wholeStepsOnly}` and `clock(ms)`. Two additions, no fork:

- `packages/render`: a pure `liveTurnLine(t: LiveTurn): string` — `Writing · 4 s · 3 tool calls`, `Running bash sleep 3 · 7 s`, `Waiting for the model · 12 s · 5 tool calls`. Golden-tested. The TUI, the CLI follow output and the board card all render this, so the words cannot drift from the web row.
- The web keeps its two-element row (`LiveActivity`) and the board gets the same fields (below). The vocabulary is `liveTurn`'s; nothing spells a state a second time.

**Board efficiency.** The board deliberately does not open a stream per card (`Work.tsx` uses one coalesced `worker.activity` frame per worker, VS-328). Keep that: the daemon's activity service (`packages/core/src/activity/index.ts`, throttled 2 s) already has the run's events, so it computes `liveTurn(events, [], now, {partialOutput})` and adds `state`, `label`, `toolCount`, `turnMs`, `sinceLastMs` to the `worker.activity` payload (`packages/shared`). Board and header render state + elapsed + tool count from it, and the fallback becomes the state word ("Starting", "Waiting for the model"), never a bare "Working". Partials are not needed for these states; a generating model reads as "waiting for the model", which is true on a card.

## 3. Web conversations — the live row and the delivery line

`LiveSection` becomes: the compaction row when compacting (unchanged, VS-454), otherwise `<LiveActivity events={liveEvents} partials={partials} lastPartialAt partialSince runtimeId />`, then the streaming partials (`LivePartials`) inside the run-view container, then `ChatTrace`. `ChatConversation` forwards a new `runtimeId` prop; `ChatPage` passes the conductor runtime and `PlanTab` the planner runtime, both already resolved for the composer.

**The delivery line.** Streamed text is rendered only inside the run-view section (`LivePartials`), exactly where the run's trace is; it is never routed through `threads.outbound` or any message component, and it disappears when the completed event supersedes it. The conductor's words reach captain only through `weave_human_send`/`weave_ticket_comment`, and a planner's only when it sends. This is the line VS-595 drew and VS-602 keeps; a test asserts that streaming a weaver turn creates no outbound thread message.

## 4. TUI and CLI (VS-603 brief — follow-up)

`weave attach` already holds the run's `events` and an SSE subscription. Add: read `GET /runs/:id/live` on open/reconnect, handle `run.delta` frames on the existing workspace subscription, and render a new Ink `<ActivityLine>` (in `packages/tui/src/components/`) above the status bar using `liveTurnLine` + `clock` on a one-second `useNow`. `weave chat` renders the same line in its `working` block. `weave top` shows the `activity` label + elapsed already returned by `GET /workers`, refreshed by the `worker.activity` frame it already receives. `weave runs tail` prints `liveTurnLine` on each delta and a completed-step line on completion, using the shared formatter.

Because tmux/herdr/hyprland all launch `weave attach`, they become live with #10; the surface adapters are untouched. Headless renders no view and is recorded as such.

## 5. Telegram — the channel progress contract (VS-604 brief — follow-up)

Today the adapter sends one `typing` action per inbound message and nothing until the run's single outbound message arrives. The daemon must tell it a run is live. Design:

- **Contract.** `packages/channel-sdk` gains an optional method on the adapter: `progress?(p: ChannelProgress)` with `ChannelProgress = { threadExternalId: string; phase: 'start' | 'update' | 'end'; text?: string }`. Optional, so every existing channel compiles unchanged; the channel-contract test gains a case that an adapter without it is still valid.
- **Driver.** `ChannelManager` already subscribes to workspace events (`channels.ts:203-209`). It additionally handles the ephemeral `run.event` / `run.delta` frames: resolve the run's `agentId`, find the channel threads bound to that agent (`threads.list({agentId})`), and for each live run call `progress('start')` once, coalesced `progress('update', {text: liveTurnLine(...)})` at the activity cadence (≤ one per 2 s), and `progress('end')` when the run finishes. A run with no bound channel thread does nothing. `run.delta` is already redacted by the engine (VS-595), so no new redaction path.
- **Telegram.** Implement `progress` in `packages/channels/telegram`: `start` refreshes `sendChatAction(chatId, 'typing')` and sends one placeholder message; `update` refreshes typing (Telegram's typing action expires in ~5 s) no more often than every ~4 s and edits the placeholder with `editMessageText`, no more often than every ~3 s; `end` leaves the placeholder for the outbound answer to replace, or deletes it if no answer follows. A 429 maps through the existing `mapTelegramError`/`retryAfterSec` handling (`api.ts:11-36`) and schedules the next update after `retry_after`; progress failures are logged and never fail the turn. `TelegramClient` gains `editMessageText` (a thin `call`), so the fake-`fetchImpl` tests already in `test/adapter.test.ts` cover it.
- **Why one message, not many.** Telegram has no "replace" affordance other than editing; a message per state would spam the thread. Rate limits are the platform's (`editMessageText` ~1/s per chat; typing ~every 5 s), so the coalescer targets ~3-4 s.

## 6. Tests

- `packages/render`: golden `liveTurnLine` for each state (streaming, thinking, tool, waiting, starting, whole steps only, long tool-only turn).
- `packages/ui`: a component test per audited web surface that a live run never renders an empty/bare working state (weaver chat, planner chat, role session, board card, decision card, runs row); a test that a streamed weaver turn produces no outbound thread message.
- Core: the activity service emits the enriched `worker.activity` frame.

(VS-603 adds the TUI/CLI state formatting and follow-output tests; VS-604 adds the Telegram progress and rate-limit tests.)

## 7. Acceptance evidence (outside the worktree, attached to the ticket)

Rendered screenshots in every theme (dark, light) at desktop and phone width for: the weaver chat mid-turn, the planner chat mid-turn, a role session mid-turn, and a board card mid-turn. (Terminal captures belong to VS-603 and a Telegram transcript to VS-604.)

## 8. Slices

1. Shared formatter + enriched `worker.activity` (#5/#7/#8/#9 data path). — done
2. Web conversations (#1/#2, delivered by VS-599, kept here) and role sessions (#3a). — done
3. Remaining web surfaces (#4/#8/#9) and the board wiring on the enriched frame. — done
4. Rendered evidence and the closing full suite.

Slice 4 of the plan (TUI + CLI, #10-13) is VS-603; slice 5 (channel-sdk progress + ChannelManager + Telegram, #15) is VS-604.

## 9. Risks

- **The weaver's un-sent words.** Showing streamed text in the weaver chat could be read as a delivered message. Mitigation: it renders only in the run-view section, never through the outbound path, and is superseded by the completed event; a test pins that no outbound message is created.
- **Activity-frame width.** Enriching `worker.activity` changes a shared payload. It is additive; existing readers ignore the new fields, and the board is the only new consumer.
- **A per-card stream would be wasteful.** The board keeps the coalesced frame; if a future surface needs partials there, that is its own ticket.
- **VS-599 merged while this was planned.** It delivered the chat wiring ahead of this change; the web chat's streaming text now depends on the runtime emitting partials, while the activity row and every non-partial state work regardless, and the whole-steps-only line covers the rest.
- **VS-603 and VS-604 own the TUI/CLI and channel work.** Their scope is briefed in §1, §4 and §5; nothing in this change should be read as covering them. (Telegram progress text for VS-604 is generic state only — never commands, paths or model text.)