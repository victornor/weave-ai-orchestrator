## Why

Chatting with a persistent role session, captain now sees a live activity row and, on any other conversation surface, the words as they stream — but the session chat still waits for the delivered final message before showing anything it wrote. Captain, 2026-09-20 (after the live-progress release `0c15b7f1f8`): "I don't want to wait for it to finish the final message before I get outputs in the chat", and it should look like the worker live view. The gap is one surface: `SessionThreadFeed` renders only `LiveActivity` (VS-602) and throws away the streamed text and the live trace that `ChatConversation` — the weaver and planner chats — and the worker live feed already render.

Captain's addition, 2026-09-20 02:41Z, same ticket and PR: "Maybe add a toggle to show mid-response traces for weaver chat as well. But I agree it should be off by default." Today `ChatConversation` renders the weaver's streamed text to captain unasked, which can be mistaken for something the weaver decided to say. The weaver chat therefore gets a switch, off by default, for the streamed text and the mid-turn tool trace.

## What Changes

- **The session chat shows the live turn.** `SessionThreadFeed` (a ticketless persistent session's conversation in `packages/ui/src/v2/WorkerPage.tsx`) renders the streaming text and reasoning still being generated, each tool call and its result as it arrives, and the live activity row — below the conversation's delivered messages, where the turn's answer will land. It reuses `liveTurn`, `LivePartials`, `LiveActivity` and the existing live trace; nothing is forked.
- **One live section, not two.** `ChatConversation`'s private live-section body is extracted into a shared `LiveTurnSection` and used by both `ChatConversation` and `SessionThreadFeed`, so a session's live turn reads exactly like the weaver's and a planner's and the three cannot drift.
- **The weaver chat's stream is opt-in (off by default).** A switch — in Settings → This device → Chat beside "Turns with no reply" — controls the weaver's streamed text and mid-turn tool trace. **Off:** only the messages the weaver has sent plus the one-line activity row; no streamed text and no trace. **On:** the streamed text and trace are shown inside a container explicitly labelled as in-progress run output, not a delivered message, and are replaced by the weaver's real message the moment it arrives (nothing duplicated). The switch is remembered in this browser across reloads (the daemon has no per-user settings store; every chat-display preference — theme, text size, "Turns with no reply" — is device-local). The planner chat and a role session are unaffected and stream as today.
- **The delivered message replaces the live turn cleanly.** The finished run is held on screen until the thread carries its answer — or its VS-596 system notice, which carries the same run id — so there is no duplicated text and no frame of empty space. A runtime that declares no partial output still says so in words.
- **The delivery line is preserved.** Streamed text is a run view on every surface. The weaver's stream never reaches a human except through `weave_human_send` / `weave_ticket_comment`, and the switch's off state makes that visible; a persistent session is a direct conversation, so its stream is shown, but streaming still creates no thread message — the session's words reach the thread only as its delivered final answer or a tool it calls. Partial frames keep the same secret redaction as persisted events (already done by the engine).
- **The audit is recorded.** Every other surface a person chats with an agent is listed in `design.md` with what it shows mid-turn; only the ticketless session feed needs a change beyond the weaver toggle.

## Capabilities

### New Capabilities
(none)

### Modified Capabilities
- `interface-live-progress`: the "Role sessions show live progress" requirement broadens from the activity row alone to the full live turn — streamed text, tool calls and their results, and the activity row — replaced by the delivered answer or system notice without duplication, with the run view kept distinct from the thread. The "Web conversations show the live row as run view" requirement changes so the weaver chat's streamed text and mid-turn tool trace are off by default and opt-in through a browser-remembered switch, while the planner chat keeps streaming and the delivery rule is unchanged.

## Impact

- `packages/ui`: a new shared `LiveTurnSection` (`v2/`), a new `lib/liveRunPrefs.ts` device preference, a new switch in `settings/sections.tsx` (DeviceSection), `ChatConversation` gaining a `showStreamedOutput` prop, `ChatPage` reading the preference and passing it, and `SessionThreadFeed` in `v2/WorkerPage.tsx` rendering the shared section; component and preference tests.
- No change to `packages/core`, `packages/server`, `packages/shared`, the API, run storage or any migration. No new route or frame; `docs/API.md` is untouched.
- Partial-output coverage is whatever the runtimes already declare (VS-599/600/601); this change renders what exists and says "whole steps only" where there is none.
