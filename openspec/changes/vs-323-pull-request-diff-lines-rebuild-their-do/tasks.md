# Tasks

## 1. Memoise the diff line's highlighted markup

- [x] 1.1 In `FileBody`, compute `lang` and a `useCallback`-wrapped `highlight` keyed on `[hljs, lang]` before the early returns, so a line's `highlight` reference is stable across re-renders.
- [x] 1.2 In `Code`, memoise the `{ __html }` wrapper on `[text, highlight]`, so an unchanged line keeps the same object and React 19's reference comparison leaves its DOM alone.
- [x] 1.3 Leave `highlightLine`'s escaping untouched, so the produced markup is byte-for-byte what it was.

## 2. Prove it with a test

- [x] 2.1 Add a test that opens a file, selects a line's text, triggers an unrelated parent re-render, and asserts the line's text node is the same object (`===`) and the selection survives; confirm the test fails on the pre-change code (verified: the text-node `toBe` fails) and passes after it. A jsdom probe confirmed a fresh `{ __html }` object does clear the selection, so the selection assertion is meaningful rather than vacuous.

## 3. Green checks and delivery

- [x] 3.1 `pnpm lint`, `pnpm typecheck` and both test suites green; both suite blocks pasted verbatim in the report.
- [x] 3.2 Open the PR and transition the ticket to `in_review`.
