## 1. Daemon

- [x] 1.1 Add `decisions.dismiss(actor, id, reason?)` (human only, askable kinds only, open only; sets `withdrawn` + answered-by fields + trimmed reason; logs `decision.dismiss`; emits the closed event) and its `DecisionsService` type
- [x] 1.2 Wake the asking agent with a `decision_answered` wake marked `dismissed: true` carrying the reason, no `answer`
- [x] 1.3 Render the dismissed wake in the asker's turn prompt (not under "Answered decisions"), and keep it in `weave_inbox`'s decisions bucket
- [x] 1.4 Add `POST /decisions/:id/dismiss` and its route-table entry

## 2. CLI

- [x] 2.1 Add `weave decision dismiss <id> [--reason]`

## 3. UI

- [x] 3.1 Add `useDismissDecision` (removes the card from open lists, like `useAnswerDecision`)
- [x] 3.2 Add the `Dismiss…` control and optional reason field to the V2 decision card for askable kinds only, and wire it on Needs you and the chat pane

## 4. Tests and checks

- [x] 4.1 Core tests: dismiss records reason/actor, refuses other kinds, closed decisions and agent actors; the wake and the prompt line
- [x] 4.2 Server, CLI and UI tests for the route, the command and the card (reason, no reason, no control on approvals, cancel)
- [x] 4.3 Run `pnpm lint`, `pnpm typecheck` and `pnpm test`, pasting both suite blocks
