## 1. Test fidelity: verify true position, not call count

- [x] 1.1 In `packages/ui/src/test/chat.test.tsx`, change the `window.HTMLElement.prototype.scrollIntoView`
      stub from a bare `vi.fn()` to one that moves the fake scroll container's simulated `scrollTop`
      toward the bottom (reusing the file's existing `scrollable()`-style fake geometry), and verify
      every existing test in the "ChatRoute follow the bottom" and "ChatRoute on a phone with the
      keyboard open" describe blocks still passes unchanged.
- [x] 1.2 Add a regression test that appends a message whose rendered height grows after the follow
      has already scrolled to it (`resizeObserved()` fired after the initial scroll, mirroring the
      real-browser CDP reproduction in this change's `design.md`), and assert the list ends at its
      true bottom (`scrollTop === scrollHeight - clientHeight`), not merely that `scrollIntoView` was
      called again.
- [x] 1.3 Add a regression test that appends several messages in a rapid burst (multiple `rerender`s
      with growing `state.messages` before the previous scroll would have settled) and assert the
      list ends at its true bottom after the burst.

## 2. Diagnostic recorder

- [x] 2.1 Add `packages/ui/src/lib/scrollDiagnostics.ts`: a capped ring buffer (last 300 samples) of
      `{t, event, scrollTop, scrollHeight, clientHeight, atBottom, following, opened}`, a `record()`
      function gated by `localStorage.getItem('ac:scroll-diag') === '1'` read once at module load, and
      a `window.__acScrollDiagnostics()` export returning the buffer as a plain array. `record()` is a
      no-op when the flag is off (no allocation, no timestamp read). Unit-test the ring buffer's cap
      and the on/off gating directly.
- [x] 2.2 Wire `record()` into `packages/ui/src/lib/stickToBottom.ts` at the three existing
      measurement points — the `onScroll` handler, the content-follow effect, and the geometry `pin()`
      callback — passing an `event` label and the values already in scope at each. Verify
      `pnpm typecheck` and the full `stickToBottom`/`chat` test suites are unaffected (diagnostics off
      by default in tests, per the existing `localStorage` fakes).

## 3. Verification and delivery

- [x] 3.1 `pnpm lint && pnpm typecheck && pnpm test` green.
- [x] 3.2 In the PR description, state plainly: no reproduction of the reported bug was found despite
      real-browser (headless-Chromium, CDP-driven) testing of the ticket's three suggested triggers;
      name the evidence in `design.md` — Context; and give captain the exact steps to enable
      diagnostics, reproduce, and export the recorded sequence (`localStorage.setItem('ac:scroll-diag',
      '1')`, reload, reproduce, `copy(window.__acScrollDiagnostics())` in devtools, paste into a
      ticket comment).
