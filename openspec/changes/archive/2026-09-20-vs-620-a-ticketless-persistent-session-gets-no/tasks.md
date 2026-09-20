## 1. Scope skills to the session's posture

- [x] 1.1 Add `SESSION_SKILLS` (the `all`-audience skills) and change `skillsFor` in `packages/core/src/workers/home.ts` to take the agent and select by `kind` + `ticketId`; verify `packages/core/src/workers/home.test.ts` covers worker, weaver, planner, ticketless session and ticketed session sets
- [x] 1.2 Add the skill posture to the home marker and to `currentRevisions`, and make `ensureHomeCurrent` re-render when it changes; verify a hometest shows a session home re-renders when its ticket posture flips
- [x] 1.3 Verify `takeTicketForSession` and `releaseSessionTicket` re-render through `renderHome` at checkout and on ticket finish (they do); add a `workers.test.ts` assertion that a ticketless session's home carries the all-audience set, checkout adds the worker-audience skills, and release removes them again

## 2. Reply bookkeeping for a tool-only turn

- [x] 2.1 Make `sessionReplyContext`'s no-thread-context fallback resolve the retried run's own `human_message` wakes in `packages/core/src/runs/engine.ts` (keeping the thread scan only for a retry whose run was not human-woken); verify the engine test for a tool-only turn then a second message links the answer to the second message only
- [x] 2.2 Verify the existing VS-598 resume tests still pass (a watchdog-cut turn then its resumed answer; a self-scheduled turn does not answer a stale message)

## 3. Audit and verification

- [x] 3.1 Confirm the design.md audit table against the code at the change base (the home template, `SESSION_NOW`, and the tool descriptions shown to a session) and that no session-visible rule remains only to tidy replies
- [x] 3.2 Run `pnpm lint`, `pnpm typecheck`, and the core/server test suite once with `--maxWorkers=4`, then the UI suite; paste both suite blocks verbatim in the ticket report
