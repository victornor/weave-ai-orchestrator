## Why

V2 (`/v2`, VS-343) ships the shell and a route with a header for every destination, and VS-345 added
the two pieces the chat consumes — the V2 decision card (with its narrow-pane variant) and the shared
worker feed. Chat is the screen the human lives in: it is the workspace's default view and the Global
Chats ticket builds directly on it, so if it is not built next, both drift. Its contract is HANDOFF.md
§1, §5, the chat-pane parts of §6 and §15, with the chat screens in `docs/design/v2/Screens.dc.html`.

## What Changes

- **The V2 Chat screen at `/v2/w/:ws/chat`**, split by default: the conversation on the left and the
  workspace's open decisions on the right, rendered with VS-345's narrow card. A draggable divider sets
  the decisions pane between 300px and 560px. Below ~620px of the chat region's own width the decisions
  pane drops out and chat goes full width; on phone there is no decisions pane. Answering a decision in
  the pane works through the same answer path V1 uses.
- **Chat's own 38px status bar**, replacing the generic V2 header: workers running, the needs-you count,
  and session usage from `GET /usage/accounts` (limit percent and reset), all derived from the same
  queries their sources use.
- **Messages**: timestamps and token counts; a Reply affordance sending `replyToMessageId`; the collapsed
  summary line (`▸ weaver did N tool calls · Ns · N tok · N/1M ctx`, from the run's trace/usage); no
  weaver avatar.
- **Working traces**: narration between tool calls in italic at a dimmer ink; tool rows carrying the tool
  name and its argument; result lines indented two spaces under the call that produced them. Markdown
  rendering of trace text is kept (VS-319).
- **Inline references and attachments**: ticket ids render as clickable bordered mono tags, literals like
  `main` stay code spans, page links are underlined prose links; attachments (artifacts, files,
  knowledge pages) render as rows under the message body with glyph, byline and kind.
- **The composer**: paperclip, microphone and send as three identical buttons on the raised surface with
  6px corners; a project scope selector above it (`Auto · each project in its hue`, sent as
  `projectId`); the dictation recording animation restyled to V2. Attachments both ways, the
  thread-search and selection-survives-updates capabilities V1 has, and the unsent draft V1 keeps when
  the human navigates away (through the same `lib/drafts` helper) are kept.
- **Frontend only.** No daemon, API or migration change. Data comes from the existing
  `packages/ui/src/api/**` hooks and `@weave-ai/shared` / `@weave-ai/render` helpers; V1 at `/` is
  untouched.

## Capabilities

### New Capabilities

- `web-v2/chat`: the V2 Chat screen — the split conversation/decisions layout with its draggable divider
  and collapse threshold, the 38px status bar, message rendering (timestamps, token counts, Reply, the
  collapsed summary line, no avatar), working traces, inline ticket reference tags, and attachment rows.
- `web-v2/chat-composer`: the V2 chat composer — the three identical attach/dictate/send controls, the
  project scope selector, attachments in and out, the V2 dictation animation, and the kept V1 chat
  capabilities (thread search, selection that survives updates).

### Modified Capabilities

_None. V2 is additive; VS-343's shell and VS-345's card and feed keep their behavior, and V1 is
unchanged._

## Impact

- **New:** `packages/ui/src/v2/ChatPage.tsx` (screen, split layout, status bar, message list),
  `packages/ui/src/v2/ChatTrace.tsx` (the working-trace renderer), `packages/ui/src/v2/ChatMessage.tsx`
  (references and attachment rows), `packages/ui/src/v2/ChatComposer.tsx` (controls, project scope,
  dictation, search), and a small pure `packages/ui/src/v2/chatSplit.ts` for the divider bounds and
  collapse threshold. New UI tests under `packages/ui/src/test/`.
- **Modified:** `packages/ui/src/v2/pages.tsx` (the `V2ChatPage` placeholder becomes the real screen),
  `packages/ui/src/v2/v2.css` (the ticket-reference tag and prose-link recipes the message body needs).
- **Reused, not forked:** `packages/ui/src/api/**` (`useThreads`, `useThreadMessages`,
  `usePostThreadMessage`, `useThreadSearch`, `useMessageContext`, `useDecisions`, `useAnswerDecision`,
  `useWorkers`, `useWeaver`, `useUsageAccounts`, `useRunTraces`, `useRunEvents`, `useRunEventStream`,
  `useRuntimeModels`, `useRuntimes`, `useProjects`, `useTickets`), `lib/dictation`, `VoiceMeter`,
  `Markdown`, `lib/transcript` (`runEventsToTranscript`), `lib/dispatch` (`chatEntries`/`chatRows`),
  `lib/stickToBottom`, `lib/drafts`, `lib/queue`, `lib/format`, `lib/projectColor`, and
  `@weave-ai/render` (`contextStrip`, `resolveModel`, `runtimeLimitStrip`, `attachmentPartsOf`,
  `attachmentToView`).
- No HTTP route, MCP tool, CLI command, database migration or daemon change.
