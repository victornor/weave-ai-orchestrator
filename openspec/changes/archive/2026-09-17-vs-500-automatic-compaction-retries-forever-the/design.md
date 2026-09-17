## Context

See proposal.md for the motivation and the runtime-session-compaction requirements. The dispatcher reads `agent_sessions.last_context_tokens` as the automatic-policy observation and calls the shared worker compaction service. The service sets `compacting_at`, starts the runtime operation asynchronously, and later clears the mark while storing `compacting_error` on failure. It currently never consumes `last_context_tokens`.

The live journal narrows the incident: all 45 attempts reported `tokens: 813725, threshold: 500000`; two attempts succeeded at 16:41:07Z and 16:42:40Z, while 43 later attempts failed quickly without a boundary. The successful attempts prove the Claude adapter's boundary predicate is observing the correct event. The failures are the result of repeatedly compacting an already-compacted session, not evidence that the predicate should be loosened.

## Goals / Non-Goals

**Goals:**

- Consume the context observation when any out-of-band compaction attempt starts.
- Ensure both success and failure leave the held wake able to dispatch, with failure details preserved.
- Preserve the shared manual and automatic compaction path and Claude's boundary-evidence requirement.
- Add regression tests that exercise repeated ticks and failed attempts.

**Non-Goals:**

- Changing Claude's command arguments or accepting exit status as compaction proof.
- Adding a migration or a second persistent latch for a value already represented by `last_context_tokens`.
- Reworking wake scheduling, turn context accounting, or the user-facing compaction UI.

## Decisions

### Consume the observation in the shared compaction service

Once the service has validated the session and is about to mark it compacting, it will set `last_context_tokens` to `NULL` on that session. This makes the observation one-shot before the asynchronous runtime call begins, so a success, a runtime failure, or an exception cannot leave the dispatcher eligible to retry the same value. The next turn's normal usage recording supplies the next observation. Because manual “Compact now” uses the same service, it receives the same safe one-shot behavior.

An alternative is a new `last_compacted_context_tokens` or attempt-status column. That adds migration and stale-state recovery rules without improving the required behavior; consuming the existing observation is sufficient and matches the existing null sentinel semantics.

### Keep failure handling and wake release unchanged, but test the contract

The asynchronous completion path already writes the adapter's failure message to `compacting_error`, emits the session-compaction failure event, and clears `compacting_at`. With the observation consumed at start, the next dispatcher tick can claim the held wake and cannot start another policy compaction. Tests will assert the stored context is cleared, the error remains, and a second tick makes one turn rather than another compaction.

### Keep strict Claude boundary detection

The adapter will not be changed. Existing event fixtures and a fake-CLI test harness will pin both outcomes: a `system`/`compact_boundary` line is required for success, and a zero-exit/no-boundary response remains a failure with diagnostic detail. This follows the journal evidence and avoids converting a no-op repeated compaction into a false success.

## Risks / Trade-offs

- **A failed compaction is not automatically retried.** → This is intentional: the pending turn gets a chance to report the failure, and a later turn's fresh context measurement can trigger a new attempt if appropriate.
- **Manual compaction consumes the current context observation.** → This prevents an immediately following dispatcher tick from treating the same pre-manual-compaction measurement as a new automatic trigger; the next turn records fresh usage.
- **The live journal evidence is not reproduced in a worker-side CLI run.** → The real CLI remains forbidden by the credential-safety contract; the ticket/PR records the owner-supplied journal diagnosis and tests use the existing fixture plus a fake binary.

## Migration Plan

No database migration is required. Deploy the code change, monitor `worker.compact_session` activity and session-compaction failure events, and roll back the application if unexpected compaction behavior appears; the nullable `last_context_tokens` field remains compatible with both versions.
