# Tasks

- [x] 1. Collapse grouped tool calls in `v2/ChatTrace.tsx`: `ToolGroup` starts collapsed showing one `tool ×N` line with a `▸`/`▾` disclosure, and opens to list its calls; a single tool call shows its one-line summary with its result behind its own disclosure.
- [x] 2. Cap tool-result and command output in a scrollable container (`ac-scroll max-h-40 overflow-auto`), keeping the diff-style colouring.
- [x] 3. Keep expansion per turn: an opened group stays open as new events arrive, and a closed one stays closed; remember the finished-turn `ChatTurnTrace` open state through `lib/traceExpansion.ts`.
- [x] 4. Show "The live stream dropped." and Refresh in `v2/ChatPage.tsx` only when `runStreamStatus.state` is `unreachable` or `offline`.
- [x] 5. Tests: a `×3` group renders collapsed and opens; an opened group survives a new event; long output sits in a capped scroll container; Refresh is absent while healthy and present when offline/unreachable. Confirm `pnpm lint`, `pnpm typecheck` and both suites pass.
- [x] 6. Composer focus (captain, 23:28): the `v2/ChatComposer.tsx` textarea shows no focus outline, ring or border change when focused (opt out of the global `:focus-visible` ring as V1's shared composer does), while the attach, dictate and send buttons keep their focus-visible indication. Test it.
- [x] 7. File-edit previews (captain, 23:31): an edit/write tool call in a V2 trace shows its file path, collapsed by default, opening to highlighted hunks in the capped scroll container. Reuse V1's `EditPayloadBody` (`diffHunksForEdits` + `DiffHunks`), not a second renderer; `WorkerFeed` already renders edits through `RunTranscript`. Tests through the shared renderer in the chat trace and the worker feed.
