## 1. Owner-scoped default key

- [x] 1.1 In `packages/core/src/decisions/service.ts`, resolve `owner` before deriving the default key in `create()` and derive it as `` `${input.kind}:${owner}:${requestedTicketId ?? 'workspace'}` ``; leave an explicit `input.correlationKey` untouched. Verify the decisions unit suite passes (`pnpm vitest run packages/core/src/decisions`).
- [x] 1.2 Update the existing assertions that pin the old derived-key shape (`decisions.test.ts` workspace-level `approval:workspace`, the attached and detached `question:<ticketId>` cases) to the owner-scoped form. Verify the same suite passes.

## 2. Escalation coverage

- [x] 2.1 Add a test that a worker `question` and the conductor's own `question` about the same ticket are both `open` and neither supersedes the other (the escalation pair). Verify it fails against the pre-change derivation and passes after 1.1.
- [x] 2.2 Add the same check for a worker `concern`, and for a worker `gate_finding` whose human-reaching escalation is a `question`. Verify both cards stay `open`.
- [x] 2.3 Add a test that once the human answers the conductor's escalation, answering the worker's still-open decision succeeds and wakes the worker with the answer. Verify the wake payload carries the answer.
- [x] 2.4 Add a test that a repeat ask of the same kind by the same owner on the same ticket still supersedes, and that a same-kind ask by the other owner on that ticket does not. Verify both.

## 3. Checks

- [x] 3.1 Run `pnpm lint`, `pnpm typecheck`, and `pnpm test`; both suite blocks green. Record both blocks verbatim in the ticket report.
- [x] 3.2 Run `openspec validate vs-519-escalating-a-worker-s-question-destroys --json --strict` clean before requesting `proposed`.
