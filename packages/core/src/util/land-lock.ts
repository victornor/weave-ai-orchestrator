import { createSerializer, type Serializer } from './serialize.js';

/**
 * One archive-then-land critical section per project (VS-327 design.md Decision 2), shared by
 * `tickets.mergeDone`'s archive-then-merge sequence and `openspec.archiveAfterMerge`'s backfill
 * path — both mutate a project's primary clone and must never interleave. Project ids are globally
 * unique ULIDs, so one process-wide instance, keyed by project id, is safe across every workspace.
 */
export const landLock: Serializer = createSerializer();
