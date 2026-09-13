## Context

See `proposal.md` — Why. V2 lives under `packages/ui/src/v2/`, mounted lazily at `/v2` in
`router.tsx`; workspace pages are wrapped in the same `WorkspaceProvider` V1 uses, so
`useThreads` / `useThreadMessages` / `useWs` already resolve for `/v2/w/:ws/chat`. VS-343 shipped the
shell, `V2Page` and the Mono tokens scoped to `.v2-root`; VS-345 shipped `v2/DecisionCard.tsx` (with
its `narrow` variant) and `v2/WorkerFeed.tsx`. `v2/pages.tsx` still renders `V2ChatPage` as a bare
`<V2Page title="Chat" />`, and that placeholder is what this ticket replaces.

V1's `routes/Chat.tsx` is the data-flow reference and is not to be changed: it owns thread resolution
(`useThreads` → `useCreateThread` → `useThreadMessages`), the live-turn subscription
(`useRunEventStream` on the weaver's run, driven by `run.started` / `run.finished` workspace events),
the trace summaries (`useRunTraces`), the decision surface (`useDecisions` / `useAnswerDecision`), and
the send path (`usePostThreadMessage`, offline queue, attachment multipart). The reusable presentational
pieces are `Markdown` (with the VS-321 stable-innerHTML fix), `VoiceMeter`, `lib/dictation`,
`lib/transcript` (`runEventsToTranscript` / `groupConsecutiveTools`), `lib/dispatch`
(`chatEntries` / `chatRows`), `lib/stickToBottom`, `lib/format`, `lib/projectColor`, and the
`@weave-ai/render` view models (`contextStrip`, `resolveModel`, `runtimeLimitStrip`,
`attachmentPartsOf`, `attachmentToView`).

## Goals / Non-Goals

- Goal: the V2 Chat screen — split conversation/decisions, its own status bar, message metadata,
  working traces, reference tags and attachment rows.
- Goal: the V2 composer — three controls, project scope, V2 dictation, attachments, kept search, and
  the unsent draft V1 keeps across navigation.
- Goal: reuse V1's data flow and shared view models by import; do not fork the API layer or the
  run-event source.
- Non-goal: Global Chats' multi-pane view, Needs you, Roles, Live, and the ticket page.
- Non-goal: any daemon, API, migration or V1 change. V1 at `/` is untouched.

## Decisions

### The screen renders its own 38px bar instead of `V2Page`

`V2Page`'s header is the breadcrumb style every other destination uses; Chat's bar replaces it
(HANDOFF §5), so `V2ChatPage` does not wrap in `V2Page`. The bar is its own component with the three
figures derived from the queries their owners use: running workers from `useWorkers` filtered to
`status === 'running'`, the needs-you count from the same `useDecisions({ status: 'open', owner: 'human' })`
result the pane renders, and the session limit from `runtimeLimitStrip(useUsageAccounts(...), weaverRuntimeId)`
using `useWeaver` for the runtime id and `useRuntimeModels` for the context window. Deriving all three
from the rendered sources is HANDOFF §15's one-source rule.

_Alternative considered:_ keep `V2Page` and pass the figures into its header. Rejected: the header is a
breadcrumb, and Chat deliberately does not show a breadcrumb (it shows the workspace name and then the
status line, as the mockup does).

### The split threshold is a pure function over the chat region's width

The mockup measures the shell (`ResizeObserver` on the chat shell) and splits at `paneW >= 620`; the
decisions pane's own width is a separate, draggable value (300–560, default 360). The build extracts
both into a pure `v2/chatSplit.ts` (`SPLIT_MIN_WIDTH = 620`, `DIVIDER_MIN = 300`, `DIVIDER_MAX = 560`,
`shouldSplit(width)`, `clampDivider(width)`) so the threshold and the clamp are unit-testable without
jsdom geometry — the project's testing convention is to test the model as a pure function when the
harness cannot measure layout. A small `useElementWidth` hook (ResizeObserver, guarded for undefined)
feeds the observed width in; a component test injects it.

_Alternative considered:_ reuse V1's `useMediaQuery('(max-width: 767px)')` and a fixed rail width.
Rejected: the mockup's threshold is the pane's own width, not the viewport's, and the divider is
draggable — a viewport media query cannot express either.

### The working trace reuses the transcript view model, not V1's trace markup

V1's `TurnTrace` / `Transcript` / `RunTranscript` carry V1's visual language (rounded bordered tool
boxes, `StatusGlyph`). The design's working trace is a different anatomy: an italic dim narration, a
tool row naming the tool and argument, and result lines indented two spaces. The build adds
`v2/ChatTrace.tsx`, which consumes the pure `runEventsToTranscript` / `groupConsecutiveTools` view model
(VS-319's markdown rendering is preserved by rendering text blocks through `Markdown`) and renders the
V2 anatomy. The run-event source is shared with VS-345's `WorkerFeed`: the live turn comes from
`useRunEventStream`, a finished turn's trace from `useRunEvents` on demand, and the collapsed summary
line from a `RunTrace` in `useRunTraces`. `WorkerFeed` stays the bounded feed for decisions/Live/Roles;
Chat's inline trace is a different presentation of the same events, so it is its own renderer rather
than a `WorkerFeed` call.

_Alternative considered:_ render `WorkerFeed` inline in the conversation. Rejected: it is a bounded,
self-scrolling live feed for embedding in a card; the mockup's conversation trace is unbounded and
flows with the message column, with its own indentation and italic rules.

### Reference tags are anchors styled by V2 CSS

V1's `MessageBody` rewrites ticket identifiers to `[ACME-42](#ticket:ACME-42)` so the markdown renderer
keeps them as anchors; V2 does the same and adds `.v2-root` CSS for `a[href^="#ticket:"]` (the bordered
mono tag recipe, `.v2-tag`) and for prose links (underlined). The click handler intercepts the anchor
and navigates to the ticket. Literals stay `<code>` from `markdownToHtml`. This keeps markdown context
intact (a ticket id inside bold text still renders) and reuses the shared renderer rather than
hand-splitting the body.

_Alternative considered:_ split the body into text and ticket tokens and render segments. Rejected: it
breaks markdown context across token boundaries and duplicates the renderer.

### Selection stability comes from `Markdown`, not from Chat

VS-321's fix lives in `components/Markdown.tsx` (memoised `dangerouslySetInnerHTML` wrapper). Chat
reuses `Markdown` for message bodies, so a stable DOM across unrelated re-renders is inherited; the
build only has to keep message keys stable (the message id) and not remount the list on every update.
No Chat-local selection code is written.

### The composer is a V2 component over V1's dictation hook

A new `v2/ChatComposer.tsx` renders the three controls and the project scope selector and reuses
`lib/dictation` and `VoiceMeter` (which reads `--accent`, so it paints in V2's Mono palette inside
`.v2-root`). Sending goes through `usePostThreadMessage` with `projectId` / `replyToMessageId` /
`idempotencyKey` exactly as V1, and attachments use the shared multipart path. The offline queue
(`lib/queue`) and the timeout/lock semantics are kept. V1's `Composer` is not modified, because it is
shared by ticket comments, decision notes and plan revisions across V1.

_Alternative considered:_ add a `variant="v2"` prop to V1's `Composer`. Rejected: it would put V2
tokens and layout inside a V1 component that many V1 screens depend on, risking V1 regressions.

### Search is V2 markup over the shared search hook

`useThreadSearch` already searches a thread's whole stored history; the build renders a small V2 result
panel over it and jumps via `useMessageContext`, mirroring V1's `ThreadSearchPanel` without its V1
dialog chrome.

### Drafts use the shared `lib/drafts` helper

The composer holds its unsent text, reply target and project choice through `useDraft(draftKey(ws,
'thread:<id>'))`, the same helper V1 uses, so a half-typed message survives leaving Chat for another V2
screen and coming back (and a reload). The draft is keyed by workspace and thread, so it never crosses
either, and it clears on a confirmed send. Staged attachment `File`s are not part of the draft — a File
cannot be serialised and V1 does not persist them either — so they are held in component state for the
mounted screen, exactly as V1 does.

### Attachments render from the message's own parts

The design's attachment rows name artifacts, files and knowledge pages, but the message data model
carries `attachment` parts only (`attachmentPartsOf`: images and text files). The build renders those
as V2 rows — a glyph by media kind, a byline and a kind label, images as previews and files as download
links — which is V1's "attachments sent both ways" restyled. The artifact/page taxonomy is not a data
shape the frontend has without a backend change, and the mockup's rows are placeholder data, so it is
not invented here.

## Risks / Trade-offs

- **[Reimplementing chat data flow risks divergence from V1]** → Reuse the hooks and the pure view
  models; only the visual tree is V2's. Where V1 has non-obvious behavior (offline queue, secret
  refusal, send lock), call the same helpers rather than re-deriving them.
- **[jsdom cannot measure the split threshold]** → Test the pure `chatSplit` functions, and the
  component with an injected width; verify the visual result by eye against the mockup. Do not shrink
  the feature to fit the harness.
- **[The status bar's session figure depends on the weaver runtime resolving]** → When the runtime or an
  account snapshot is absent, show the same quiet fallback `SessionLimit` does, never a zeroed bar.
- **[The conversation re-renders on every live event]** → Stable message keys plus the memoised
  `Markdown` wrapper keep the DOM stable; a long history is rendered from `chatRows`, which is already
  the windowed shape V1 uses.

## Migration Plan

Frontend-only and additive. No data migration; deployment is the daemon's normal UI build. Rollback is
reverting the V2 module; V1 is unaffected.

## Open Questions

_None that change the specs, approach or task breakdown. The artifact/file/page attachment taxonomy the
mockup sketches would need a message part the backend does not write; it is out of scope here._
