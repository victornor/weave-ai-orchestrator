## 1. `WorkspaceProvider` gets a `live` prop

- [x] 1.1 Add an optional `live` prop to `WorkspaceProvider` (`packages/ui/src/api/context.tsx`),
      default `true`. When `false`, the mount effect does not construct an `EventStream` (context
      exposes `stream: null`, `connection` left at a steady non-offline default) instead of
      opening one. Verify with a unit test asserting the `EventStream` constructor (mocked) is not
      called when `live={false}` and is called when `live` is omitted or `true`.
- [x] 1.2 Verify `/w/:ws/chat` (single-workspace chat) is unaffected: its `WorkspaceProvider` call
      site passes no `live` prop, so its existing tests keep passing unchanged.

## 2. `ChatPage` gets a `focused` prop

- [x] 2.1 Add an optional `focused` prop to `ChatPage` (`packages/ui/src/routes/Chat.tsx`),
      default `true`. Gate `useRunEventStream`'s `live` option on `focused` (in addition to the
      existing `live?.running` check) so the run-tail `EventSource` never opens for an unfocused
      pane. Gate the "conductor is working" live block's render on `focused` too, so an unfocused
      pane renders no live-turn UI.
- [x] 2.2 Confirm the "resume mid-turn" effect (which reads `conductor.data?.lastRun`, independent
      of any stream) still runs regardless of `focused`, so an unfocused pane's working indicator
      still appears from the polled conductor query even without opening a stream — verify with a
      test that mounts `ChatPage focused={false}` against a mid-turn `conductor` query result and
      asserts a working indicator (not the streamed transcript) shows.
- [x] 2.3 Verify `ChatRoute` (`<ChatPage key={ws} />`, used by `/w/:ws/chat`) passes no `focused`
      prop and its existing tests keep passing unchanged.

## 3. `GlobalChatsRoute`: one focused pane, bounded connections

- [x] 3.1 Add focused-workspace state to `GlobalChatsRoute` (`packages/ui/src/routes/GlobalChats.tsx`),
      defaulting to the first listed workspace's id.
- [x] 3.2 Make each pane's header a clickable control that sets that workspace as focused; give
      the focused pane a visible, accessible indication of which one it is (e.g. `aria-current` or
      equivalent) so it is assertable in a test, not just visual.
- [x] 3.3 Wire `live={w.id === focusedId}` into each pane's `WorkspaceProvider` and
      `focused={w.id === focusedId}` into its `ChatPage`.
- [x] 3.4 On becoming focused, invalidate that workspace's thread-messages and decisions queries
      (`qk.threadMessages`, `qk.decisions`) so a pane that missed activity while unfocused is
      caught up immediately rather than waiting out its own query's refetch timing.
- [x] 3.5 Stop rendering `FanInStreams` on `/chats` (`packages/ui/src/app/AppShell.tsx`): change
      its render gate from `onGlobalPage` to exclude the `/chats` path specifically. Verify
      `/needs`, `/live`, `/incidents`, `/map` still render it (existing `appshell.test.tsx`
      coverage) and `/chats` does not.

## 4. Tests proving the fix, not just the shape

- [x] 4.1 Extend `packages/ui/src/test/globalChats.test.tsx`: render `GlobalChatsRoute` with ten
      mocked workspaces (more than fit under a 6-connection HTTP/1.1 cap) and assert the mocked
      `WorkspaceProvider`/`EventStream` construction stays at a small constant (one live) rather
      than growing with workspace count — this is the test that fails against the old
      one-stream-per-pane behavior and passes against the fix.
- [x] 4.2 Add a test that clicking a second pane's header moves the live subscription to that
      pane (the first pane's `live` prop flips to `false`, the second's to `true`) and that the
      previously-focused pane still renders its own history/composer.
- [x] 4.3 Add a test for the catch-up refetch: focusing a pane triggers invalidation of that
      workspace's messages/decisions queries (task 3.4).
- [x] 4.4 Keep both pre-existing `globalChats.test.tsx` assertions (labelled panes per workspace;
      `WorkspaceProvider` called once per workspace with `remember: false`) passing — extend the
      mock's captured call shape to include `live` rather than replacing the assertions.

## 5. Wrap-up

- [x] 5.1 `pnpm lint && pnpm typecheck && pnpm test` green. (`pnpm test`: 2034/2035 passed, 1 skipped;
      the one failure, `packages/core/src/runs/engine.test.ts`'s "resumes the same ticket on its own
      once the runtime recovers" test, is a pre-existing ULID-tie race unrelated to this change — this
      branch touches nothing in `packages/core`, and the same test fails intermittently in isolation
      too, ~1 run in 3, on repeated runs.)
- [x] 5.2 One-line knowledge note on the two independent per-pane stream sources (`WorkspaceProvider`'s
      `EventStream` and `useRunEventStream`'s own `EventSource`) if not already covered by an
      existing knowledge document — future workers touching live streams need to know both exist.
