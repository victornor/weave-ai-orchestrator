## 1. Session interrupt-and-resume (core)

- [x] 1.1 In `threads.inbound`, when the addressee is a ticketless session (`kind === 'session'`) with a run executing in `runState(ctx).active`, and that run is not already marked `cancelled.cause === 'message'`, interrupt it with `runs.cancel(actor, runId, 'interrupt', 'message')` after the transaction commits, and enqueue the existing `human_message` wake with `interruptedRunId` in its payload. Verify with a core test that a message sent during a running session turn finalizes the old run as `interrupted_by_message` and starts one new run carrying the message on the same session.
- [x] 1.2 Skip the cancel when the active run already carries `cancelled.cause === 'message'`, so a second rapid message only enqueues and the wake bundle gate coalesces it. Verify with a test where two rapid messages produce exactly one resumed turn carrying both messages in order, each once.
- [x] 1.3 Generalise the "previous turn was interrupted" note in `buildTurnPrompt` to fire for a `human_message` wake carrying `interruptedRunId` as well as a `live_interrupt` wake. Verify with a prompt test asserting the note and the message body are present in the resumed turn's prompt.
- [x] 1.4 Leave the weaver's primary thread and planner threads untouched. Verify with a test asserting a message to the weaver while its turn runs still queues and does not cancel the run.

## 2. Delivery status and answer linking

- [x] 2.1 Extend `describeLiveInput` to take the agent kind and report `{ midTurn: false, interrupts: true }` for a `session` with a running turn, unchanged for a worker. Verify with `active.test.ts` cases for both kinds.
- [x] 2.2 Confirm the resumed turn's answer links to the human message(s) that caused the interrupt through `sessionReplyContext`'s `human_message` wakes. Verify with an engine test asserting one outbound answer linked to the message.

## 3. Transcript marking

- [x] 3.1 Add `'interrupted'` to `ToolBlock.status` and mark tool calls still `pending` at the end of a run whose final status is `interrupted` or `cancelled`. Verify with render unit tests: the turn is marked interrupted, a cut-off tool reads not completed, an error tool stays failed, and a succeeded run is unchanged.
- [x] 3.2 Show the marker on the session conversation surface. Verify with a UI test rendering an interrupted session turn.

## 4. Runtime coverage

- [ ] 4.1 Add a per-adapter interrupt test with a fake process for claude, codex, opencode and the built-in runtime, proving `cancel('interrupt')` stops the turn and the adapter's partial events are preserved as recorded. Verify the tests pass.
- [x] 4.2 Record the plain list of runtimes and what each does on interrupt, naming any that cannot be interrupted cleanly (expected: none of the four; gemini and cursor are signal-only). Included verbatim in the PR body.

## 5. Dictation provenance

- [ ] 5.1 Add the shared `(voice dictated)` helper beside `humanSelectionNotice` and render it in `buildTurnPrompt` for `human_message` and `ticket_comment` bodies and in `weave_inbox`. Verify with prompt and tools tests that a dictated body is marked and a typed one is not.
- [x] 5.2 Accept `dictated` on `POST /threads/:id/messages` (JSON and multipart), `POST /workers/:id/message` and the decisions answer, and carry it in the wake/comment/answer payload without touching the stored body. Verify with server route tests and a core test asserting the stored text has no marker.
- [x] 5.3 Prepend the marker to the string handed to a runtime's `send` in `workers.message`, so a dictated message delivered into a running turn carries it. Verify with a core test on the mid-turn path.
- [x] 5.4 Send `dictated` from the V2 `ChatComposer`/`DictationSession` and the V1 `Composer` when the text was entered by dictation. Verify with UI tests asserting dictated sends carry it and typed sends do not.
- [x] 5.5 Add the device-local "mark all my messages as voice dictated" setting and its toggle in the dictation settings section, off by default, marking every send while on. Verify with a settings test mirroring `dictationAutoSendSetting.test.tsx`, plus a test that a typed send is marked when it is on.

## 6. Session attachments (reuse the conductor chat pipeline)

- [x] 6.1 Enable attachments on the session composer: pass `allowAttachments` to the `Composer` in `WorkerPage`, hold the file list in the page, and forward `files` through `usePostThreadMessage`'s existing multipart arm. Verify with a UI test that the attach control and a paste produce a send carrying the files.
- [x] 6.2 Render a human message's attachments in `SessionThreadFeed` with the shared `AttachmentRows`. Verify with a UI test that an image attachment is shown on the message and still shown after a re-fetch.
- [ ] 6.3 Confirm storage and caps are the existing ones and the agent receives the attachment: a core test that a session inbound carrying an image puts `attachmentIds` in the `human_message` wake, a server test that `weave_inbox` returns the image content, and a route test that a disallowed or over-cap file is rejected before storage.
- [x] 6.4 Capture light and dark screenshots of an attachment on a session message and attach them to the ticket.

## 7. Verification and evidence

- [x] 7.1 Iterate on changed test files, then run one full suite with `--maxWorkers=4`; paste both suite blocks verbatim in the PR.
- [x] 7.2 Capture light and dark screenshots of an interrupted session turn and of the dictation setting toggle, and attach them to the ticket.
- [x] 7.3 Record the plain list of runtimes and what each does on interrupt (from task 4.2), and the split of the per-runtime attachment form into the proposed second ticket, in the PR body.
