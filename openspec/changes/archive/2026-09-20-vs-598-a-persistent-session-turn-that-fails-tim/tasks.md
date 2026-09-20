## 1. A resumed session turn still reports

- [x] 1.1 Give `sessionReplyContext` in `packages/core/src/runs/engine.ts` an optional `{ agentId, deps }` fallback: when the wake yields no thread and only when a flattened wake's source is `retry`, resolve `deps().threads.list({ agentId })[0]` and the trailing run of `inbound` messages at the end of that thread, returning the thread and those message ids only when the trailing run is non-empty. Pass it from the delivery step and from `finalize`'s retry-carry, gated to `agent.kind === 'session'`. Verify: the engine test "a watchdog-cut turn resumes on a retry wake and answers once" passes with a retry wake that carries no thread context.
- [x] 1.2 A retry-woken resume that fails posts one notice. Verify: the test "a retry-woken resume that fails posts one notice" asserts one `system` outbound row naming the plain reason.
- [x] 1.3 An unrelated self-scheduled turn does not answer a stale human message. Verify: the test "a self-scheduled turn does not answer a stale human message" seeds an unanswered message, runs a `self_scheduled` turn, and asserts no outbound row.
- [x] 1.4 The answer is linked to every human message sent before the turn ended. Verify: the test "links the answer to every human message sent before the turn ended" sends two messages, runs one turn, and asserts one answer whose `thread_message_replies` link both.

## 2. A usage limit or an expired login says what happens next

- [x] 2.1 `sessionOutcomeNotice` branches a `failed` `provider_quota` run to a `quotaNotice`: name the limit, add the reset instant from `parseResetTime`/`fmtUtc` when the runtime reported one, and close with "Nothing retries automatically — send another message to try again." Remove the now-unreachable quota line from `plainFailureReason`. Verify: the test "names the reset time and the manual step for a usage limit" asserts the reset text and the manual-step text.
- [x] 2.2 Replace the `auth` early-return with a notice that says a new login is needed and states what happens next, choosing between "resumes once the login is renewed" and "log in, then retry" from whether the run's wakes are still `queued` after `finalize` (the auth ladder preserved them or parked the work). Verify: the test "tells the human a login is needed and what happens next" asserts the resume wording when the wake is preserved.

## 3. The session surface shows the notice

- [x] 3.1 Confirm VS-596's `SessionThreadFeed` `authorKind === 'system'` branch renders the failed-turn notice with the existing style and needs no code change; if it does not, add the branch. Verify: the component test seeded with a failed-turn system message asserts the notice renders as a centred muted notice, not a bubble.
- [x] 3.2 Produce rendered evidence of a session thread carrying a failed-turn notice in every theme at desktop (1440×900) and phone (390×844) width, from a throwaway harness authored outside `work/`; since the model cannot view images, verify each render by dumping the DOM and asserting the notice's structure/text/classes, attach the captures to the ticket with `weave_ticket_attachment_put`, then delete the harness so `git status --porcelain` in `work/` is empty.

## 4. Verification

- [x] 4.1 Run `pnpm lint` and `pnpm typecheck`, then the full suite one suite at a time with `--maxWorkers=4`, and paste both suite blocks verbatim in the report (core/server and UI separately; never one as both).
- [x] 4.2 `openspec validate vs-598-a-persistent-session-turn-that-fails-tim --json --strict` is clean before requesting review.