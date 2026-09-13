## 1. Reproduce, failing

- [x] 1.1 Add a `packages/ui/src/test/` regression test (chat route, real `Range`/`window.getSelection()`
      against a real DOM node, list scrolled up per the existing "reading position" test's
      geometry-mocking pattern) that selects text in an older message, appends a new message via the
      mocked `useThreadMessages` data and re-renders, and asserts the older message's own DOM node is
      unchanged (`===`) and the selection string is unchanged. Run it and confirm it fails against the
      unmodified `Markdown.tsx`, with the failure showing the `<p>` node was replaced. Added as
      `ChatRoute selection stability (VS-321)` in `packages/ui/src/test/chat.test.tsx`; confirmed
      failing pre-fix (`expected <p></p> to be <p></p> // Object.is equality`).
- [x] 1.2 Add the equivalent case for a live trace event arriving over the run's `EventSource` while
      scrolled up (same assertions), and confirm it fails the same way before the fix. Confirmed
      failing pre-fix alongside 1.1.

## 2. Fix

- [x] 2.1 In `packages/ui/src/components/Markdown.tsx`, memoise the `dangerouslySetInnerHTML` wrapper
      object on the already-memoised `html` string (`useMemo(() => ({ __html: html }), [html])`) and
      pass that memoised value instead of a fresh `{ __html: html }` literal. Verified both tests from
      section 1 now pass.
- [x] 2.2 Verify a decision card appearing (a new open decision arriving via the decisions query) and a
      messages refetch that returns identical content also leave an older message's selection intact,
      per the spec's added requirement. Added as two more cases in the same describe block; both pass.
- [x] 2.3 Verify stick-to-bottom is unaffected: the existing `ChatRoute reading position` and
      `scroll-follow` tests (a reader at the bottom still follows; a reader scrolled up is not yanked
      down, per VS-197) still pass unmodified. Confirmed: all 199 tests in `chat.test.tsx` pass,
      including those describes, unchanged.

## 3. Verify and deliver

- [x] 3.1 Run `pnpm lint`, `pnpm typecheck`, and `pnpm test` (both the core/server suite and the UI
      suite — paste both blocks verbatim in the delivery report, per this project's convention on
      never reporting only one suite as if it covered both). All green: lint clean, typecheck clean,
      core/server 182 files / 2750 tests passed (1 skipped), UI 98 files / 1622 tests passed.
- [x] 3.2 Note in the PR description that `packages/ui/src/routes/project/PullRequestDiff.tsx:148` has
      the identical unmemoised `{ __html }` pattern outside `Markdown` and is left for a follow-up
      ticket, per the proposal's Impact section.
