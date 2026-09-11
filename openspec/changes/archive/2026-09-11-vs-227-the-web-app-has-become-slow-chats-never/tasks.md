## 1. Stream connection budget

- [x] 1.1 Pause `EventStream` and `useLiveStream` while `document.visibilityState === 'hidden'`, resume from `lastSeq` / `after` on visible, without incrementing backoff. Verify in `eventStream.test.tsx` and `sseStream.test.tsx`: hiding closes the fake EventSource; showing opens one whose URL includes `after=` of the last delivered seq; hidden is not treated as `offline`.
- [x] 1.2 On Live (workspace and global), cap concurrent run-tail EventSources so a visible page with many working workers still leaves REST slots (in-view or first two cells stream; the rest wait). Verify in `liveFloor.test.tsx` / `globalLive.test.tsx` / `liveTranscript.test.tsx`: N>2 streaming cells do not open N EventSources at once; a cell that starts streaming after another stops does open one.
- [x] 1.3 Keep `/chats` FanInStreams gated off (`AppShell` `path !== '/chats'`). Verify existing `appshell.test.tsx` FanInStreams gating still passes.

## 2. Send acknowledgement

- [x] 2.1 `POST /threads/:id/messages` uses a 15s abort timeout; timeout maps to `NetworkError`. Verify in `chat.test.tsx` (daemon-unreachable / sending describe): a send whose fetch never settles leaves “Sending…” then, after the timeout, the composer is usable again and the text is kept or queued.
- [x] 2.2 `Chat.tsx` `send()` clears `sending` when `mutateAsync` settles successfully, not only on `run.finished`. Verify in `chat.test.tsx`: after a successful POST with no `run.finished`, the composer is not showing “Sending…”; “Conductor is working” may still show if a run is live.

## 3. Chats populate from REST

- [x] 3.1 GET `/threads` and GET `/threads/:id/messages` use a 30s abort timeout so a starved request becomes `ErrorState` + retry rather than an eternal skeleton. Verify in `chat.test.tsx` / `globalChats.test.tsx`: a hanging messages fetch eventually shows the pane error and retry, not the skeleton forever.
- [x] 3.2 `useRunTraces` is disabled until `oldestLoaded` or `messageRuns` is known. Verify a chat test: mounting Chat with conductor id and no messages does not request `/runs/traces`.
- [x] 3.3 Tickets fetched for chat labels omit `description` (list query param or projection). Verify: the tickets list used by Chat does not include description in the JSON; `GET /tickets/:id` still returns it; dispatch-label tests still find identifier/title/status. Record payload size against live fern-services in the PR (was 857 KB with descriptions).

## 4. Verification

- [x] 4.1 Add a connection-budget test that holds enough fake EventSources to fill a 6-slot cap, asserts messages/send fetches are still invoked (or streams drop on hidden so they can be). Verify it fails if visibility gating is removed.
- [x] 4.2 `pnpm lint && pnpm typecheck && pnpm test` at the repo root. Paste **both** suite blocks verbatim on the ticket (core/server and UI separately; do not add them, do not retype, do not report UI numbers as “both”).
- [x] 4.3 On the ticket, state explicitly: `run_events` is 276,940 rows / ~225 MB and is **not** the query-time cause of empty panes (traces 3.2 ms); retention is a follow-up, not shipped here.
