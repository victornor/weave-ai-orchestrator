# Design

## The two unstable values

React only skips a `dangerouslySetInnerHTML` write when the prop object is the same reference. There
are two values on this path that change identity on every render of `FileBody`:

1. the `{ __html }` object literal itself, and
2. the `highlight` function it closes over (`const highlight: Highlighter = (text) => …`), which is
   recreated on every render.

Memoising only the wrapper object on `[text]` would not help while `highlight` is recreated, because
`Code`'s memo would still be asked to recompute and would still produce a new object.

## The fix

- `FileBody` computes `lang` and a `useCallback`-wrapped `highlight` keyed on `[hljs, lang]`, both
  before its early returns (hooks must run unconditionally). `hljs` comes from `useHighlighter()`,
  which is a stable `useState` value that changes at most once (null → loaded bundle); `lang` is a
  string derived from the path. Neither changes on an unrelated re-render.
- `Code` memoises the wrapper on `[text, highlight]`, so an unchanged line keeps the same
  `{ __html }` object and React's reference comparison leaves its DOM — text node and any selection —
  alone.

The alternative of threading `hljs`/`lang` into `Code` would work too, but it would spread the
highlighter's plumbing through `UnifiedHunk`, `SplitHunk` and `Gap` for no behavioural difference.
The `useCallback` keeps the existing `highlight` prop shape.

## The test

The regression is observed through the rebuilt text node, not the `<span>`: rewriting `innerHTML`
replaces the span's child text node while the span element object survives, so asserting on the span
would pass even with the bug. The test selects the line's contents, records `line.firstChild`, fires
an unrelated parent re-render, and asserts both `firstChild === recorded` and
`window.getSelection().toString()` unchanged. jsdom does clear the selection when the text node is
replaced (verified against a probe with a fresh object), so the selection assertion is not vacuous.
