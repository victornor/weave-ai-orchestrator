# Tasks

- [x] 1. In `packages/ui/src/lib/stickToBottom.ts`, pause `following` only when a real scroll gesture (wheel, touch, scroll key, or a scrollbar drag starting on the scroller) is behind an off-bottom scroll; a gestureless scroll — content shrink under a clamped list, an older-page prepend, a composer-driven geometry change — never pauses. Button, unread marker, paging and reduced motion unchanged.
- [x] 2. In `packages/ui/src/v2/ChatPage.tsx`, call `stick.toBottom()` on a successful send and on a queued one, so sending always returns to the true bottom and resumes following.
- [x] 3. Tests in `packages/ui/src/test/stickToBottom.test.tsx`: wheel and touch upward scrolls pause; a gestureless scroll, clientHeight shrink and a prepended older page do not; a scrollbar drag pauses while a click on the content does not. Update the V1 `chat.test.tsx` scroll-up tests to bring a real gesture.
- [x] 4. A V2 chat test: sending from a scrolled-up view returns to the bottom and follows the arriving reply.
- [x] 5. Evidence: a scripted headless-Chromium run (≥50 scroll-up-then-send cycles, growth/reveal while following, composer growth) reporting max/final distance from the true bottom and unintended-pause count, before and after, plus a capture of the chat at the bottom after a send; committed under `docs/reviews/vs-451/`.
- [x] 6. `pnpm lint`, `pnpm typecheck`, and both test suites pass; tick tasks; open the PR and move to review.
