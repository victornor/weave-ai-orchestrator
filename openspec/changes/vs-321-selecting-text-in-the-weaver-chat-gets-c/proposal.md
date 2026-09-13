## Why

Reported by captain (2026-09-13): highlighting older text in the weaver chat to copy it gets
deselected the instant a new message, a live trace event, a decision card or a refetch lands —
because every one of those causes a re-render, and every re-render of `Markdown` (the shared renderer
behind every message body, ticket comment, plan preview and decision card) hands React a brand-new
`{ __html }` object literal. React's `updateProperties` diffs `dangerouslySetInnerHTML` by that
wrapper object's **reference**, not by `.__html`'s string value (see `setProp`'s
`dangerouslySetInnerHTML` case in `react-dom-client.development.js`, called whenever
`nextProps.dangerouslySetInnerHTML !== lastProps.dangerouslySetInnerHTML`): a changed reference with
byte-identical content still triggers an unconditional `domElement.innerHTML = html`, tearing down
and rebuilding every child node underneath — including whatever the reader had selected — even though
nothing about that message changed. This reproduces with a scripted test (see `design.md`) and is
confirmed the root cause, not the row-keying, composer-focus or markdown-memoisation suspects the
ticket listed as already ruled out.

## What Changes

- `Markdown` (`packages/ui/src/components/Markdown.tsx`) memoises the `dangerouslySetInnerHTML`
  wrapper object itself (`useMemo(() => ({ __html: html }), [html])`), keyed on the already-memoised
  `html` string, so its reference stays stable across a re-render that did not change the rendered
  content. React then skips the `dangerouslySetInnerHTML` diff entirely (same reference) and the DOM
  subtree it produced — and any selection anchored inside it — survives untouched.
- No behavioural change to what is rendered, no new prop, no change to `markdownToHtml` itself: this
  is the one memoisation that was missing, in the one component every markdown body in the app
  (chat messages, ticket comments, plan previews, decision cards, knowledge docs) already goes
  through.

## Capabilities

### New Capabilities
(none)

### Modified Capabilities
- `conductor-chat/message-formatting`: adds the requirement that rendering a message whose content
  has not changed must not replace the DOM nodes it produced, so a reader's text selection and native
  browser find-in-page state survive an unrelated re-render.

## Impact

- `packages/ui/src/components/Markdown.tsx` — the one-line fix.
- Every screen that renders markdown through it (`Chat.tsx`, `TicketPage.tsx`, `DecisionCard`/
  `PlanPreview`, `KnowledgeExplorer`, `KnowledgeDocs`, `Team`, `WorkerPage`,
  `project/ProjectOverview`, `project/PullRequestsSection`) stops rewriting unchanged DOM on every
  re-render, not only the chat.
- Out of scope, flagged separately: `packages/ui/src/routes/project/PullRequestDiff.tsx:148` has the
  identical `dangerouslySetInnerHTML={{ __html: highlight(text) }}` pattern outside `Markdown`, so a
  diff line's highlighted markup is rebuilt on every re-render too. Not touched here — the ticket
  scopes this to the weaver chat's shared renderer — but worth its own follow-up.
- No API, schema or stored-data change; `docs/API.md` and `docs/PLAN.md` need no update.
