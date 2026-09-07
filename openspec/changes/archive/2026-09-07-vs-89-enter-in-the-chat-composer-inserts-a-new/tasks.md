## 1. Composer behaviour

- [x] 1.1 In `packages/ui/src/components/Composer.tsx`, make the textarea's `onKeyDown` send on unmodified Enter only when `isTouch` is false, and leave the event alone otherwise; verify by reading that no `preventDefault()`/`send()` path remains for the touch case.
- [x] 1.2 Set `enterKeyHint="enter"` on the textarea when `isTouch`, and leave the attribute off otherwise; verify the rendered textarea carries the attribute under `(hover: none)` and not under a hovering pointer.

## 2. Tests

- [x] 2.1 Add a `matchMedia` helper to the composer tests that answers `(hover: none)` per case, restoring the original afterwards; verify the existing composer and dictation tests still pass unchanged.
- [x] 2.2 Cover the desk case: unmodified Enter sends and clears, `Shift+Enter` does not send; verify by running `pnpm --filter @agent-conductor/ui exec vitest run`.
- [x] 2.3 Cover the touch case: unmodified Enter does not send and the default is not prevented, the send button still sends, and `enterKeyHint` is present; verify by the same vitest run.

## 3. Checks

- [x] 3.1 Run `pnpm typecheck`, `pnpm lint` and the full `pnpm test`; verify all three are green before delivering.
