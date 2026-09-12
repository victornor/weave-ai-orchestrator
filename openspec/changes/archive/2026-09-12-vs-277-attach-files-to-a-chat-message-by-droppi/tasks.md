## 1. Composer drop handling

- [x] 1.1 Add a file-only drag check (`dataTransfer.types` includes `Files`) and a `dragActive` state plus a `dragDepth` ref to `Composer.tsx`; verify by reading the component that non-file drags never touch the highlight.
- [x] 1.2 Add `onDragEnter`/`onDragOver`/`onDragLeave`/`onDrop` handlers to the composer's bordered container that `preventDefault()` on `dragover` and `drop` for file drags only, maintain the depth counter, and call `addFiles(Array.from(e.dataTransfer.files))` on drop; verify all four handlers are gated on `allowAttachments` and file-ness.
- [x] 1.3 Extend the container's border `className` to `border-accent` when `dragActive`, reusing the existing active-border idiom; verify no new class or token is introduced.
- [x] 1.4 Run `pnpm typecheck` in `work/` and verify it passes with no errors.

## 2. Window-level browser-default guard

- [x] 2.1 Register a `window` `dragover` and `drop` listener in a `useEffect` that runs while `allowAttachments` is true and is removed on cleanup; both call `preventDefault()` only when `dataTransfer.types` includes `Files` and do nothing otherwise; verify no highlight or attachment state is touched by these listeners.
- [x] 2.2 Have the window `drop` listener reset `dragDepth` to zero and clear `dragActive`, so a drag that leaves the window without a matching `dragleave` cannot strand the highlight; verify by reading the handler.
- [x] 2.3 Run `pnpm --filter @weave-ai/ui exec vitest run src/test/components.test.tsx` and verify the existing composer tests still pass with the window listeners mounted.

## 3. Tests

- [x] 3.1 Add a test that a file drop adds the same pending chip paste produces; verify `pnpm --filter @weave-ai/ui exec vitest run src/test/components.test.tsx` passes.
- [x] 3.2 Add a test that a disallowed-type drop attaches nothing and shows the acceptance error; verify it fails against a handler that skips `addFiles` and passes with it.
- [x] 3.3 Add a test that dropping more than the per-message cap attaches four and shows the limit message.
- [x] 3.4 Add a test that a non-file drag (types without `Files`) over the composer shows no highlight and that a non-file drop does not attach anything or call `preventDefault`.
- [x] 3.5 Add a test that dropping where `allowAttachments` is false attaches nothing and shows no highlight.
- [x] 3.6 Add a test that `dragover`/`drop` of a file calls `preventDefault` (assert `fireEvent` returns false) so the browser does not navigate.
- [x] 3.7 Add a test that a file dropped outside the composer (on the window/document) attaches nothing and still calls `preventDefault`; verify it fails when the window guard is removed.

## 4. Verification

- [x] 4.1 Run `pnpm lint`, `pnpm typecheck`, `pnpm test` and `pnpm --filter @weave-ai/ui exec vitest run` in `work/`; paste both suite blocks verbatim and confirm all green.
