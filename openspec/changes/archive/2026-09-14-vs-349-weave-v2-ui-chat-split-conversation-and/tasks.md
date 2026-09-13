## 1. The split layout

- [x] 1.1 Add `packages/ui/src/v2/chatSplit.ts` exporting `SPLIT_MIN_WIDTH = 620`, `DIVIDER_MIN = 300`,
  `DIVIDER_MAX = 560`, `DEFAULT_DIVIDER = 360`, `shouldSplit(width)` and `clampDivider(width)`, plus a
  `useElementWidth` ResizeObserver hook guarded for a missing ResizeObserver. Verify with a unit test
  that `shouldSplit` is false below 620 and true at/above it, and that `clampDivider` clamps to 300–560.

- [x] 1.2 Build `packages/ui/src/v2/ChatPage.tsx`: resolve the workspace thread exactly as V1 does
  (`useThreads`, create one on first load, `useThreadMessages`), render the conversation column and,
  when `shouldSplit(measuredWidth)` and there are open decisions, the decisions pane. Verify with a
  component test that at an injected width of 900 both the conversation and a decision card render, and
  at 500 the decision card is absent and the conversation is full width.

- [x] 1.3 Add the draggable divider: pointer drag and keyboard (Arrow/Home/End, with the bounds in
  `aria-valuemin`/`aria-valuemax`) set the pane width through `clampDivider`, and the chosen width
  persists for the session. Verify with a component test that a drag past the bounds yields 300/560 and
  that a keyboard step moves the pane by the step within the bounds.

- [x] 1.4 Render the workspace's open decisions in the pane as VS-345's narrow `V2DecisionCard`, wired
  to `useAnswerDecision` through the shared `decisionSecrets` / `decisionStaleness` / queued-answer
  path, and show an empty state when there are none. Verify with a component test that answering a card
  submits the answer mutation with the built payload and that a decision with no card shows the empty
  state.

## 2. Chat's own status bar

- [x] 2.1 Replace the generic `V2Page` header for Chat with a 38px status bar showing running workers
  (`useWorkers` filtered to `running`), the needs-you count from the same open-decision query the pane
  renders, and the session limit from `runtimeLimitStrip(useUsageAccounts(...), weaverRuntimeId)` (using
  `useWeaver` and `useRuntimeModels`), with the quiet absent-state fallback when there is no account
  snapshot. Verify with a component test that the three figures render from their sources, that the
  needs count matches the number of open decisions rendered, and that no account snapshot renders the
  fallback rather than a zeroed bar.

## 3. The conversation

- [x] 3.1 Render the message list through `chatEntries` / `chatRows`, each message keyed by its id: the
  body through `Markdown` (preserving VS-321 selection stability), the timestamp and, for a turn's
  message, the turn's token count, and no avatar. Verify with a component test that a message's time and
  tokens render and that no avatar element is present.

- [x] 3.2 Add `MessageBody`-style reference handling: rewrite ticket identifiers to `#ticket:` anchors
  and add the `.v2-root` CSS that styles them as bordered mono tags and prose links as underlined, with
  a click handler navigating to the ticket. Verify with a component test that a ticket id renders as an
  anchor carrying the tag styling and clicking it navigates, while `main` stays a code span and a page
  link is an underlined anchor.

- [x] 3.3 Add Reply: a control on a weaver message that sets the reply target, shows the quote while
  composing, and sends `replyToMessageId`; the sent message shows `replyToExcerpt`. Verify with a
  component test that activating Reply sends the next message with `replyToMessageId` and that the
  quote clears on send.

- [x] 3.4 Render each message's attachments from `attachmentPartsOf` / `attachmentToView` as rows with
  a glyph, byline and kind, images as previews and files as download links. Verify with a component
  test that an image attachment renders a preview row and a text attachment a linked row with its kind.

- [x] 3.5 Build `packages/ui/src/v2/ChatTrace.tsx` from `runEventsToTranscript` /
  `groupConsecutiveTools`: narration italic in a dimmer ink, a tool row with name and argument, result
  lines indented two spaces under their call, and markdown text rendered through `Markdown`. Verify
  with a component test that a narration block is italic and dimmer, that a tool row names the tool and
  its argument, and that a result line carries the two-space indent under its call.

- [x] 3.6 Add the collapsed summary line on a weaver message from `useRunTraces` / `useRuns`:
  `▸ weaver did N tool calls · Ns · N tok · N/1M ctx` using `contextStrip` / `resolveModel`, omitting a
  quantity the runtime did not report; opening it renders the turn's trace via `useRunEvents` and
  `ChatTrace`. Verify with a component test that a trace with tool calls, duration and tokens renders
  the line, that a trace without usage omits the token and context figures rather than printing zeros,
  and that opening it renders the trace.

- [x] 3.7 Add the live-turn block: subscribe to the weaver's in-flight run with `useRunEventStream`,
  mark the turn working (bridged while a send is in flight), and render its events through `ChatTrace`.
  Verify with a component test that a live run shows the working state and renders its streamed trace.

- [x] 3.8 Keep the conversation anchored to the bottom with `useStickToBottom`, with scroll-to-bottom
  when scrolled up and older-history loading when the top is reached. Verify with a component test that
  a new message while at the bottom keeps the bottom in view and while scrolled up shows the
  scroll-to-bottom control.

## 4. The composer

- [x] 4.1 Build `packages/ui/src/v2/ChatComposer.tsx` with three identically styled attach / dictate /
  send controls on the raised surface with 6px corners, the growing input, and the in-flight lock;
  sending posts through `usePostThreadMessage` with `idempotencyKey`. Verify with a component test that
  all three controls render, that send posts the typed text once while in flight, and that a failed send
  keeps the draft.

- [x] 4.2 Add the project scope selector above the input (`Auto` then each project in its hue via
  `projectColorVar`), sending the chosen project as `projectId` and clearing to `Auto` on a confirmed
  send. Verify with a component test that choosing a project sends its id, that `Auto` sends none, and
  that the selection clears after a confirmed send.

- [x] 4.3 Wire dictation through `lib/dictation` and `VoiceMeter`: tap-to-toggle on touch,
  push-to-talk at a desk, a V2-styled recording indicator, and appending the transcript to the existing
  text. Verify with a component test that starting dictation shows the indicator and that a recognized
  transcript is appended after existing text.

- [x] 4.4 Add the V2 search panel over `useThreadSearch` and `useMessageContext`: open from the
  composer bar, list matches, and jump the conversation to a chosen message. Verify with a component
  test that a query lists matches and that choosing one moves the conversation to that message.

- [x] 4.5 Accept attachments through the picker, paste and drag, and send them with the message text in
  the same multipart request (image and plain-text types, shared per-message limit). Verify with a
  component test that a staged file is sent with the message and that an unaccepted type is refused
  with the shared message.

- [x] 4.6 Hold the composer's unsent text, reply target and project choice through `lib/drafts`
  (`useDraft(draftKey(ws, 'thread:<id>'))`), keyed per workspace and thread and cleared on a confirmed
  send. Verify with a component test that a typed draft survives unmounting and remounting the screen,
  that a different thread shows its own draft, and that a confirmed send clears the draft.

## 5. Verification

- [x] 5.1 Run `pnpm lint` and `pnpm typecheck`; both clean.

- [x] 5.2 Run `pnpm test` (core/server suite) and `pnpm --filter @weave-ai/ui exec vitest run`
  separately; paste both suite blocks verbatim in the report and confirm both pass.

- [x] 5.3 Confirm no HTTP route, MCP tool, CLI command, database migration or daemon file changed, and
  that V1 at `/` and its tests are untouched, including that Global Chats still builds on this screen
  without the pane and status bar leaking into it.

- [x] 5.4 Run `openspec validate vs-349-weave-v2-ui-chat-split-conversation-and --json --strict` and
  confirm it is clean.

- [x] 5.5 Treat the acceptance list as the exit criteria: real history and live traces render; a
  decision answers in the pane; the divider drags within its limits and the pane drops below the
  threshold; the status bar figures match their sources; replying, attaching, the project scope and
  dictation all work.
