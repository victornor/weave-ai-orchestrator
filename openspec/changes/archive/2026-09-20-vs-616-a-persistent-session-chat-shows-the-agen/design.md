## Context

See `proposal.md` — Why. The live-progress model is already built and wired: VS-595's runtime-neutral `liveTurn` over a run's events and ephemeral partials, `LivePartials` + `LiveActivity` in `packages/ui/src/components/LiveActivity.tsx`, the V2 live trace (`ChatTrace` in `v2/ChatTrace.tsx`) and the worker feed's `RunTranscript` → `Transcript`. `SessionThreadFeed` (`v2/WorkerPage.tsx:80`) is the one conversation surface VS-602 wired only to `LiveActivity`; it opens no partials and no trace, so the session's words are invisible until the daemon delivers the final answer.

Two facts constrain the fix. A session's final answer is delivered into its own thread by VS-596's engine path as an outbound message carrying the run id, and a turn that ends without an answer posts a system notice also carrying the run id (`packages/core/src/runs/engine.ts:755`). So the thread itself says when a run has been accounted for. Separately, captain's addition (2026-09-20 02:41Z) makes the weaver chat's stream opt-in, off by default, because it can otherwise be mistaken for a delivered message.

There is no per-user settings store. Every chat-display preference is device-local (`lib/chatPrefs.ts`'s "Turns with no reply", `prefs.ts`'s rail and Live layout, theme, text size), and the Settings → This device section states it is "stored in this browser only". The switch is therefore browser-remembered, following the established `chatPrefs` read/write/publish-hook pattern.

## Goals / Non-Goals

**Goals:**
- A ticketless persistent session's chat shows, while its turn runs, the streaming text and reasoning, each tool call and result, and the activity row — matching the worker live view and the weaver/planner chats.
- The weaver chat's streamed text and mid-turn tool trace are hidden by default and shown only when the human opts in, marked as in-progress run output, with the choice remembered in the browser.
- One shared live-section implementation, used by every conversation surface, so the words and rows cannot drift.
- A delivered answer or a VS-596 system notice replaces the live turn with no duplication and no empty frame.
- The audit of every chat surface is written down.

**Non-Goals:**
- No change to the run engine, the partial-output transport, redaction or any runtime adapter. Runtime coverage stays as VS-599/600/601 declared it.
- No per-user/server settings store is introduced; the switch is device-local like every other chat-display preference. (A future user-settings store is its own ticket.)
- No change to the planner chat's behaviour (it keeps streaming) or to the role session's default (streams).
- No change to `ChatConversation`'s weaver/planner-only extras (decision cards, dispatch chips, the unattributed-worker row) or to the delivery rules.
- No new API route, event frame or persisted data.
- Not the TUI/CLI (VS-603) or Telegram (VS-604).

## Decisions

### 1. The session chat renders the conversation live section, not the worker feed's bounded box

`SessionThreadFeed` will render the same live section the weaver and planner chats render — `LivePartials`, `LiveActivity`, `ChatTrace` — placed below the delivered messages where the next turn's answer will land.

- **Why not `RunTranscript` (the worker live view's own component):** `RunTranscript` is a bounded, self-scrolling box (`max-h-[calc(var(--ac-app-h)*0.5)]`, `contained: true` stick-to-bottom) built for a tile or a card that has something around it worth keeping still. The session chat scrolls the page itself, like `ChatConversation`; nesting a second scroller inside it is the wrong shape. `ChatTrace` is V2's live trace — the same component the weaver and planner chats use — and renders each tool call and its result as it arrives.
- **Why the trace is shared at all:** the requirement is "the existing live trace components", and a session's stream should read like every other conversation's. Using the chat trace keeps the three conversation surfaces on one implementation and one vocabulary.
- **Alternative considered:** extracting only the three components and repeating the JSX in `SessionThreadFeed`. Rejected — a second copy of the composition is exactly the drift this ticket is fixing elsewhere.

### 2. Extract `ChatConversation`'s live body into a shared `LiveTurnSection`

A new `packages/ui/src/v2/LiveTurnSection.tsx` exports the non-compacting live composition. `ChatConversation.LiveSection` keeps the compaction row (VS-454) and the dropped-stream retry around it and delegates the rest; `SessionThreadFeed` renders it directly. This is a mechanical extraction of existing markup with no behaviour change to the chat beyond the new switch (below), which the existing chat tests protect.

`LiveTurnSection` renders the activity row always, and — when its output is enabled — the streamed text (`LivePartials`) and the live trace (`ChatTrace`, only when there are events) inside a container carrying a visible label, `Live run output — not sent yet` (`data-live-run-view` / `data-live-run-view-label`). A new `showOutput` prop (default `true`, so no caller changes behaviour by omission) selects whether that labelled container renders.

### 3. The weaver chat's stream is opt-in, off by default, remembered in the browser

- **The preference.** A new `packages/ui/src/lib/liveRunPrefs.ts` mirrors `chatPrefs.ts`: `readShowLiveRunOutput()` (default `false`), `writeShowLiveRunOutput(on)`, and `useShowLiveRunOutput()` which follows a same-document event plus `storage`, so an open chat updates the moment the switch is flipped. The key is `conductor.chat.liveRunOutput`; unreadable storage reads as off, which is also the privacy-safe direction.
- **The switch.** Settings → This device → Chat, beside "Turns with no reply", with a `role="switch"` control and a detail line saying off shows only sent messages plus the activity row, on shows the in-progress output, and it is stored in this browser only. This is where every chat-display preference already lives. **Alternative considered:** an inline control in the chat's status bar. Rejected — the preference is sticky and belongs with the other device-reader settings; captain asked for a toggle, not a per-turn control, and the status bar is already dense.
- **The prop.** `ChatConversation` gains `showStreamedOutput?: boolean` (default `true`) forwarded to `LiveTurnSection.showOutput`. `ChatPage` reads `useShowLiveRunOutput()` and passes it, which also covers the weaver's panes on the global chats screen (they render `V2ChatPage`). `PlanTab` passes nothing, so the planner chat keeps streaming as today.
- **Off state.** Only the sent messages and the activity row: no `LivePartials`, no `ChatTrace`. The compaction row and the dropped-stream retry are state lines, not streamed content, and stay in both states. Streaming still creates no thread message in either state.
- **On state.** The labelled container makes it explicit that the text is run output, not a delivered message; when the weaver's real message arrives, the run view is replaced by it (the run-id guard below) with nothing duplicated.

### 4. The finished run is held until the thread accounts for it

`SessionThreadFeed` keeps following the session agent's current run through `useWorkerRun` (the same resolver the worker feed uses) and tracks it as a `LiveChatRun`. When the run finishes, it stays on screen via the shared `useLiveRunSettle` (the same 4 s settle the weaver and planner chats use) until the thread carries a message with that run id — the delivered answer or the system notice — at which point it clears. The render also guards on "the thread already has a row for this run", so the live section is gone in the same render the answer appears: no duplicated text. If the answer is late, the settle window bridges it: no flash of empty space.

- **Why the row-id guard in render, not only the effect:** `useLiveRunSettle` clears in an effect, one frame after the message first renders. The guard makes the requirement hold in every frame, not just after the effect.
- **Why a turn without an answer behaves the same:** the VS-596 notice carries the run id, so it settles the live section exactly as the answer does. The notice is the consistent replacement, and the plan states that.

### 5. The run-view / delivery line per surface

| Surface | Streamed text is | How the line is kept |
|---|---|---|
| Weaver chat (`ChatConversation`) | run view, **off by default** | hidden unless the device switch is on; when on it renders only in the labelled run-view container; never a thread message; `weave_human_send` / `weave_ticket_comment` remain the only paths to a human |
| Planner chat (`PlanTab` → `ChatConversation`) | run view (unchanged) | same container, always shown; a planner's words reach the human only when it sends |
| Persistent session chat (`SessionThreadFeed`) | run view (shown by default) | shown because this is a direct human↔agent conversation; streaming creates no thread message — the session's words reach the thread only as its delivered final answer (VS-596) or a tool it calls |
| Worker feed (`RunTranscript`) | run view | unchanged |
| Decision cards / board / ticket header | state word + elapsed only (no stream); Watch opens the worker feed | unchanged (VS-602) |

## 1. Audit — every place a person chats with an agent

Read at `1fb042cf`. "Live turn" = streamed text + tool calls/results + activity row.

| # | Surface | Where | Mid-turn today | Change |
|---|---|---|---|---|
| 1 | Weaver chat | `ChatPage.tsx` → `ChatConversation.tsx` `LiveSection` | `LivePartials` + `LiveActivity` + `ChatTrace`, unasked | activity row always; streamed text + trace only when the device switch is on (default off), labelled as in-progress output |
| 2 | Planner chat / plan tab | `PlanTab.tsx` → `ChatConversation` | as #1 | unchanged — keeps streaming |
| 3 | Worker page, ticket-bound (incl. a session that took a ticket) | `WorkerPage.tsx` → `WorkerFeed.tsx` → `RunTranscript` | `Transcript` + `LivePartials` + `LiveActivity` | none |
| 4 | Worker page, ticketless persistent session | `WorkerPage.tsx` `SessionThreadFeed` | `LiveActivity` only — no partials, no trace | **the change** |
| 5 | Roles page expanded worker row / Live cards | `RolesPage.tsx` → `WorkerFeed`; `LivePage.tsx` → `WorkerFeed` | as #3 | none; collapsed row already shows the state word + elapsed (VS-602) |
| 6 | Project overview role chats | `project/RoleChatsSection.tsx` → `RoleChatControl` | nothing — a control; it navigates to `/w/:ws/workers/:id` (#3/#4) | none |
| 7 | V2 sidebar / phone More role rows | `V2Shell.tsx` → `RoleChatRow` | as #6 | none |
| 8 | Plan modal | retired by VS-556 → `PlanTab` (#2) | — | none |
| 9 | Global chats | `chats/ChatsPage.tsx` → `V2ChatPage` → `ChatConversation` | as #1 | inherits #1 |
| 10 | Decision cards | `DecisionCard.tsx` (V1/V2) | state word + elapsed; Watch opens `WorkerFeed` | none |

**Conclusion.** #4 is missing streamed text and the live trace; #1 changes to opt-in per captain's addition; #2/#3/#9 already have all three and are kept. Surfaces #6/#7 are controls, not transcripts, so "mid-turn" is what the worker page they open shows.

## 2. Tests

- `packages/ui/src/test/v2worker.test.tsx`: a live session turn renders `[data-live-partials]` carrying the streamed text and `[data-trace-tool]` rows, plus the activity row; the delivered answer (a thread message carrying the run id) leaves no live section and shows the text exactly once; a turn ending without an answer is replaced by its run-id-carrying system notice the same way; a run on a runtime that declares no partial output shows `[data-live-whole-steps]`.
- `packages/ui/src/test/v2chat.test.tsx` (or a new live-prefs test): **default off** — the weaver chat renders no `[data-live-partials]` and no `[data-trace-tool]`, only sent messages and `[data-live-activity]`; **toggling on** — `writeShowLiveRunOutput(true)` (and the same-document event) makes the stream and trace render with the `[data-live-run-view-label]` marker; the delivered message replaces the stream without duplication; `readShowLiveRunOutput` defaults to `false` and survives a round trip.
- Existing `v2chat.test.tsx` / `v2chattrace.test.tsx` / `RunTranscript.test.tsx` continue to pass, pinning that the extraction did not change the planner chat or the worker feed.

## 3. Risks / Trade-offs

- **Extracting `LiveSection` touches the weaver chat.** → Pure move of existing markup; `ChatPage`/`PlanTab` tests plus the VS-599 streaming test still run against it. The compaction row and the dropped-stream retry stay in `ChatConversation`.
- **Default-off changes what captain already sees in the weaver chat.** → Exactly captain's ask (2026-09-20 02:41Z), and the activity row still shows the weaver is working; the switch restores the old view in one click and is remembered.
- **The live section could duplicate the answer for one frame.** → The render guard on the thread's run ids, not only the settle effect.
- **`useWorkerRun` resolves the run via `useRuns`.** → Same resolver the worker live view uses; no new subscription, no new stream per tile.
- **A finished run that produced no thread message (e.g. a self-scheduled turn) lingers ~4 s.** → The existing settle behaviour, shared with the weaver/planner chats; it clears on its own.

## 4. Acceptance evidence (outside the worktree, attached to the ticket)

Rendered screenshots in both themes (dark, light) at desktop and phone width for:
- a session chat mid-turn showing streamed text and a tool call, and the moment the final message replaces it;
- a non-streaming runtime session;
- the weaver chat with the switch **off** and **on**, the on state showing the labelled in-progress run output;

compared against the worker live view.

## 5. Open Questions

(none)
