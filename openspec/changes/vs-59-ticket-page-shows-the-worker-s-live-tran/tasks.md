# Tasks

- [x] 1. `useRunEventStream(runId, { live })`: `live: false` keeps the persisted query and opens no `EventSource`, so a finished turn is fetched rather than streamed; the default stays `true` so `Chat.tsx` is unchanged.
- [x] 2. `useStickToBottom(signal, { follow })`: `follow: false` suppresses the scrolling while leaving the upward-scroll pause, the button and the unread dot as they are.
- [x] 3. `Transcript` renders at most 150 blocks, newest last, with a `Show earlier` control that reveals 150 more.
- [x] 4. `RunTranscript`: the bounded scroller both surfaces mount — its own scroll box, the follow gated on `live`, and `ScrollToBottomButton` floating over it; it scrolls its own box rather than calling `scrollIntoView`, which would walk every scrollable ancestor and drag the page with it.
- [x] 5. `run.started` / `run.finished` invalidate `qk.ticketRuns` from the `ticketId` on their payload, so the Activity tab sees a turn start and finish.
- [x] 6. `ActivityTab` renders each run as `RunTurn`: a running turn expanded and streaming, collapsing to its summary row when it finishes; a finished turn expandable on demand and requesting nothing while collapsed.
- [x] 7. `RunRoute` follows a running turn live through the same hook and component, and stops following when the run finishes.
- [x] 8. Tests: a running turn streaming into the Activity tab, its collapse on finish, expanding a finished turn (fetched, not streamed), the Run page following then stopping, the window cap and the `follow: false` gate.
