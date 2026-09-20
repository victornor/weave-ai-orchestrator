## Why

VS-595 (PR #481, merge `9bc2ebc5b8dd`) built the runtime-neutral live model — `liveTurn`, ephemeral `run.delta` frames, `GET /runs/:id/live` — and wired it into three web surfaces only: the run page, the worker feed and the ticket feed. Everywhere else a person watches or talks to an agent still shows a bare "working", silence, or nothing at all. Captain's ask (2026-09-20 00:35Z): "this needs to be working across every interface with an agent." The weaver chat and planner chat — the two surfaces a human stares at while the conductor thinks — hold the live stream already and throw its partials away to print a literal "working" (`ChatConversation.tsx:133-137`); ticketless role sessions render a plain message list with no live state; the board shows a bare "Working" with no elapsed time. (VS-599, merged while this was being planned, delivered the chat wiring; this change keeps it and covers the rest of the web.)

## What Changes

- **One shared live line.** `packages/render` gains a pure compact formatter over the existing `LiveTurn` (`liveTurnLine` + the existing `clock`), so the web board cards and the follow-up TUI/CLI work render the *same* words the web row does, never a forked second vocabulary.
- **Web: every surface that shows a live turn renders the activity row.** The weaver chat and planner chat render `LiveActivity`/`LivePartials` fed by the stream they already hold (delivered by VS-599); the ticketless role session in `SessionThreadFeed` gets a live row and a stream; the runs list, the decision cards and the board/ticket header rows get a live line. The board and ticket header keep their single-server-frame model (`worker.activity`, enriched with the `liveTurn` fields) rather than opening one stream per card.
- **The delivery line is preserved.** Streamed text is the run view on every surface; it never reaches a human channel except through `weave_human_send` / the normal outbound message path. Each surface states how it keeps that line.

### Moved out of this change (one PR per slice)

- **VS-603** takes slice 4: the TUI (`weave attach`, `weave chat`, `weave top`) and the CLI follow output (`weave runs tail`), fed from `run.delta` and `GET /runs/:id/live`, with the same shared `liveTurnLine`. The tmux, herdr and hyprland surfaces inherit it because they launch `weave attach`; the headless surface renders no view.
- **VS-604** takes slice 5: the `channel-sdk` progress hook, the `ChannelManager` driver, and the Telegram typing keep-alive plus one edited progress message. Progress text sent to an external service is generic state only — never commands, paths or model text.
- design.md §1 is the audit table both follow-ups start from; it is kept unchanged.

## Capabilities

### New Capabilities
- `interface-live-progress`: what every web interface that shows an agent must render during a live turn — the weaver/planner chats, role sessions, and the board/live/ticket/decision/runs surfaces — all consuming the same runtime-neutral `liveTurn` model, with the run view kept strictly separate from the human-facing delivery path.

### Modified Capabilities
(none in this change — the `telegram-channel` delta moved to VS-604)

## Impact

- `packages/render` (shared `liveTurnLine` formatter), `packages/ui` (`ChatConversation`/`ChatTrace`, `WorkerPage`/`SessionThreadFeed`, `Work`, `LivePage`, `RunsPage`, `DecisionCard`, `LiveActivityLine`), `packages/core/src/activity` (enrich the `worker.activity` frame from `liveTurn`), `packages/shared` (`worker.activity` payload type).
- `docs/API.md` only if a frame or route shape changes (the `worker.activity` payload gains fields; no new route).
- No migration, no new table, no change to how a run is stored. VS-599/600/601 are consumed, not touched: this change renders whatever partials a runtime emits and says "whole steps only" in words where there are none.