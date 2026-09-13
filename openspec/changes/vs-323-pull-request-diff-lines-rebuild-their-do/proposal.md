# Pull request diff lines rebuild their DOM on every re-render, so a selection in the diff is cleared

Tracker change for [VS-323](weave://tickets/VS-323). A `task` ticket, so this change carries tasks
only — `skip_specs: true`.

## Why

`packages/ui/src/routes/project/PullRequestDiff.tsx` renders every diff line as
`<span dangerouslySetInnerHTML={{ __html: highlight(text) }} />`. React 19 compares a
`dangerouslySetInnerHTML` prop by reference before writing it, and its `setProp` case then sets
`domElement.innerHTML` unconditionally when the reference differs. A fresh `{ __html }` object
literal on every render therefore rewrites the line's DOM even when the text is identical — which
clears any text selection or find-in-page match inside the diff. It also re-runs `highlight()`
(highlight.js) on every render, an avoidable cost on a large diff.

VS-321 fixes the same mechanism in `Markdown.tsx`; this is the one other `dangerouslySetInnerHTML`
use under `packages/ui/src`.

## What Changes

- `PullRequestDiff.tsx`: make the per-line `highlight` function stable for a given highlighter and
  language (`useCallback`), and memoise the `{ __html }` wrapper object on the line text (and that
  stable `highlight`) in the small `Code` component.
- `pullRequestDiff.test.tsx`: a regression test that selects a line, triggers an unrelated parent
  re-render, and asserts the line's text node is the same object and the selection survives.
- `highlightLine`'s escaping is untouched, so the highlighted markup — and every existing diff
  test — is unchanged.

## Capabilities

None. This is an internal rendering-correctness fix to a view; no stated requirement under
`openspec/specs/` describes the diff's DOM identity or re-render cost, and inventing one would be
back-filling. `skip_specs: true` is set in `.openspec.yaml`.
