## Context

See `proposal.md` - Why for the motivation. This document records the investigation that confirmed
the cause, since the ticket required reproducing it before touching anything (guessed fixes against
matched-output bugs have shipped green and stayed broken twice before on this project — see the
project knowledge base's landmine on VS-186/VS-214).

### What was ruled out, and why the ruling holds

The ticket listed three suspects as already ruled out, all confirmed still true by reading the code:

- **Composer stealing focus** (`Composer.tsx:190-192`) — only focuses on an `autoFocus` prop change,
  and `Chat.tsx` never passes `autoFocus` to it.
- **Row keys changing** (`lib/dispatch.ts:181,187`) — `chatRows` keys every row by the message id or
  `trace:<runId>`, both stable across a message list update; a new row does not change an existing
  row's key.
- **Markdown rewriting unchanged messages via its `useMemo`** — `Markdown`'s `html` value genuinely
  does stay referentially and value-equal across re-renders when `source` hasn't changed. This is
  real, but it does not matter: see below.

### What actually reproduces it

A scripted RTL/jsdom test (reproduced during this investigation, restored as `tasks.md` item 1) does:

1. Render the chat with one older message, scroll the (geometry-mocked) list up and away from the
   bottom exactly as captain described, and select that older message's text with a real `Range` /
   `window.getSelection()`.
2. Append a new message to the mocked `useThreadMessages` data and re-render (`rerender(<ChatRoute
   />)`), the same shape a real message arriving via the thread query/SSE would produce.
3. Observe, via a `MutationObserver` on the container: the older message's own `ac-prose` div (same
   div, same object — not remounted) has its single child `<p>` removed and replaced with a new `<p>`
   node carrying byte-identical text. `window.getSelection()?.toString()` is now empty.

The same happens for a live trace event (`assistant.text` over the run's `EventSource`) while
scrolled up — anything that causes `ChatPage` to re-render does this to every already-rendered
`Markdown` instance in the list, not just the one that changed.

### The actual mechanism

`Markdown.tsx` renders `<div dangerouslySetInnerHTML={{ __html: html }} />`. `html` itself is
memoised correctly (`useMemo(() => markdownToHtml(source, { breaks }), [source, breaks])`), but the
wrapper object `{ __html: html }` is a **new object literal on every render**, regardless of whether
`html`'s value changed.

React's DOM update path (`react-dom-client.development.js`, `updateProperties` → the generic
prop-diff loop used for `div`/`span`/etc.) does not unwrap `dangerouslySetInnerHTML` to compare
`.__html`. It compares the prop by reference:

```js
for (lastProp in nextProps)
  (_propKey8 = nextProps[lastProp]),
    (propKey = lastProps[lastProp]),
    !nextProps.hasOwnProperty(lastProp) ||
      _propKey8 === propKey ||                 // reference check, not .__html
      (null == _propKey8 && null == propKey) ||
      setProp(domElement, tag, lastProp, _propKey8, nextProps, propKey);
```

and `setProp`'s `"dangerouslySetInnerHTML"` case does not compare against the previous value at all —
it unconditionally does `domElement.innerHTML = value.__html` once it is called:

```js
case "dangerouslySetInnerHTML":
  if (null != value) {
    ...
    key = value.__html;
    if (null != key) {
      ...
      domElement.innerHTML = key;
    }
  }
  break;
```

So a fresh `{ __html }` object every render — even carrying the exact same string — is a changed
reference, which is enough to trigger `domElement.innerHTML = key` again. Resetting `innerHTML`
destroys every existing child node and parses new ones from the string, even though the string is
identical. A selection (or a find-in-page match) anchored inside those destroyed nodes collapses,
because the nodes it referenced no longer exist. `Markdown` is not memoised as a component and is
rendered fresh on every `ChatPage` re-render (a new message, a live trace tick, a decisions refetch —
none of which are gated behind `React.memo` anywhere in the tree), so this fires far more often than
just "this message changed."

Confirmed empirically: memoising the wrapper object (`useMemo(() => ({ __html: html }), [html])`)
makes the reference stable whenever `html`'s value is unchanged; with that in place, the same
reproduction shows `nodeBefore === nodeAfter` and the selection intact, while a genuinely new message
row is still added below it. Stick-to-bottom is unaffected by construction: this change touches
neither `useStickToBottom` nor scroll geometry, only whether an unrelated `Markdown` instance's DOM is
torn down.

## Goals / Non-Goals

**Goals:**
- Stop `Markdown` from resetting a message's DOM when its rendered content hasn't changed, for every
  screen that shares the component (chat, ticket comments, plan previews, decision cards, knowledge
  docs), not only the chat's own list.
- Prove it with the failing-first reproduction described above, checked in as a regression test.

**Non-Goals:**
- Changing `markdownToHtml`, adding copy buttons, or touching `useStickToBottom` / scroll-follow
  behavior — VS-197's contract there is untouched and re-verified, not redesigned.
- Fixing `PullRequestDiff.tsx`'s identical `dangerouslySetInnerHTML={{ __html: highlight(text) }}`
  pattern (noted in the proposal's Impact section) — different component, different screen, outside
  this ticket's scope.
- Wrapping `Markdown` (or its callers) in `React.memo`. It would reduce how often this class of
  component re-executes at all, but the object-identity bug would still exist for the renders that do
  happen (e.g. `source` itself changing on an edit), and the ticket's acceptance criteria is about
  selection surviving, not render-count. The minimal, directly-verified fix is the one above.

## Decisions

**Memoise the `dangerouslySetInnerHTML` wrapper object itself, keyed on the already-memoised `html`
string**, rather than any alternative:

- *Alternative: `React.memo(Markdown)`.* Would reduce re-renders when `source`/`className`/`breaks`
  are unchanged, but does nothing for a render that legitimately happens with unchanged `html` for
  another reason (e.g. a parent re-render where memo's shallow prop comparison still passes, which is
  the exact case reproduced here) — the object literal would still be freshly created inside the
  function body every time `Markdown` itself does run. It also changes the render behavior of every
  caller more broadly than the bug requires. Rejected as unnecessary for this fix; nothing stops it
  being added later as a separate performance change if wanted.
- *Alternative: compare `html` to a ref and only pass a new `dangerouslySetInnerHTML` object when it
  changes.* Equivalent to `useMemo(() => ({ __html: html }), [html])`, just spelled with a manual ref
  instead of the hook meant for exactly this. No reason to hand-roll it.
- *Alternative: avoid `dangerouslySetInnerHTML` altogether (parse to React elements).* Would fix this
  class of bug structurally but is a much larger rewrite of `markdownToHtml`'s output contract, well
  beyond what this ticket's bug needs.

## Risks / Trade-offs

- [The `useMemo` cache holds one extra object per `Markdown` instance] → negligible: one small object,
  same lifetime as the component, already paid for the `html` string it wraps.
- [Some other component elsewhere in the app has the same `{ __html }`-literal pattern and is not
  fixed here] → `PullRequestDiff.tsx:148` is the only other instance found (`rg dangerouslySetInnerHTML
  packages/ui/src`); flagged in the proposal's Impact section as a follow-up, not silently dropped.

## Migration Plan

None — internal rendering fix, no data or API shape changes, ships and reverts as a normal PR.
