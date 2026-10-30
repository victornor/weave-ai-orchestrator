## Context

Every path that leaves `blocked` for a ticket blocked from `merging` already goes through `transition(... to: 'merging')`, whose `mergeQueue.join` re-stamps the queue entry (resume, `resumeIfBlocked`, `tickets.retry`, the retry card). A test confirms resume and retry re-queue it. The failures are around that: the retry card relaunched the worker first and restored the ticket afterwards with errors swallowed (`.catch(() => undefined)`), so a worker could run, or be left, against a ticket with no queue entry, and nothing reported the state.

## Decisions

- **Option 2 over option 1.** Preserving `merge_queued_at` on a blocked ticket would make blocked tickets contribute to bypass credits and position counts (`merge_queued_at IS NOT NULL` queries), hand an hours-old ticket the front of the queue on return, and need every "left the queue" assertion revisited. Re-stamping on return is already how join works.
- **Order the retry:** restore before relaunch, so the turn's prompt (`mergeQueueLine`) reflects the live queue. Failure is commented on the ticket with the repair command; the relaunch still proceeds so the worker is not lost.
- **Detection is read-only:** the digest names stranded tickets and the repair; it does not auto-transition, since a block may be deliberate.

## Risks

Restoring before relaunch admits the ticket, which wakes its (paused) worker via the queue; the relaunch wake coalesces with it.
