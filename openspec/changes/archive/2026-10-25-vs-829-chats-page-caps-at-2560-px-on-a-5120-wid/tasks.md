## 1. The width model

- [x] 1.1 Add `CONVERSATION_READING_WIDTH`, `CONVERSATION_WIDEN_AT`, `CONVERSATION_MAX_WIDTH` and the pure
      `conversationMeasure(regionWidth)` to `packages/ui/src/v2/chatSplit.ts`; verify with a table test in
      `packages/ui/src/test/chatSplit.test.ts` covering 320/620/1280/1600/1601/1920/2560/3840/5120,
      monotonicity above the threshold and the clamp (`pnpm --filter @weave-ai/ui test chatSplit`).

## 2. The two call sites share it

- [x] 2.1 Feed the conversation column's measured width into `conversationMeasure` in
      `packages/ui/src/v2/ChatPage.tsx` and pass the result to `ChatConversation`; the composer wrapper and
      the message column both apply `width: 100%`, `margin-inline: auto`, `maxWidth: measure` instead of
      `max-w-[720px]`; verify with a component test rendering `V2ChatsScreen` at a wide viewport that both
      elements carry the same non-720 `maxWidth`.
- [x] 2.2 Confirm nothing else in the Chats chain caps width: grep `packages/ui/src` for `max-w-`/`max-width`
      on the Chats route's ancestors and record the result in the PR body; verify `V2Root`, `V2Shell`,
      `V2Page` and the Chats row still carry no width cap.

## 3. Real-browser verification

- [x] 3.1 Render the Chats route in headless Chromium at 1280, 1920, 2560 and 5120 px CSS width with the
      throwaway harness from `docs/ui-screenshot-harness.md` (outside the worktree), measuring each pane's
      `getBoundingClientRect().width`, the composer's and the message column's, plus `window.innerWidth`
      and `devicePixelRatio`; verify the panes sum to the row width at every size and each is about half at
      5120.
- [x] 3.2 Attach the 2560 and 5120 screenshots to the ticket, with a note of the measured viewport,
      device pixel ratio and the per-pane widths.

## 4. Docs and delivery

- [x] 4.1 Record the wide-screen rule (the conversation column widens above a wide region; the pane row
      carries no cap) in `docs/design/v2/HANDOFF.md` §3 and §5; verify the text names the resolver so the
      next screen reuses it.
- [x] 4.2 Run the UI suite and typecheck (`pnpm --filter @weave-ai/ui typecheck`, `pnpm test`), paste both
      suite blocks in the PR, and `git status --porcelain` in the worktree is empty before review.
