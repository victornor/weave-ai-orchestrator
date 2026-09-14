# ADR 0021 — The merge queue admits by priority, with a bypass-count starvation rule

Date: 2026-09-14 · Status: accepted

## Context
ADR 0006 serialized landing per project and chose first-in-first-out, with the stated consequence "Ordering is first-in-first-out, not by priority. Priority already decides what gets built; re-ordering the landing step would let a high-priority ticket jump a branch that has already rebased onto the current default branch."

On 2026-09-14 that decision cost an urgent fix. VS-388 — a critical fix stopping the test suite from stopping the live daemon — was approved at about 01:01 and joined a queue seven deep behind six UI PRs. The queue drained at roughly one merge per fifteen minutes, so the critical fix was about eighty minutes out. `ticket.priority` decided what got built and nothing about what landed.

## Decision
Waiting tickets are admitted by priority — `critical`, `high`, `medium`, `low` — then by the moment they joined, then by ticket number. A ticket already in the active merge step is never pre-empted: only the order of waiting tickets changes, so a critical still waits for the merge in flight to finish.

Starvation is measured by **bypasses, not wall-clock age**. At each admission every waiting ticket that joined earlier than the admitted ticket is credited one bypass (`tickets.merge_bypasses`, migration 0039). A waiting ticket that has reached `MERGE_BYPASS_LIMIT` (3) is admitted before every ticket that has not, in join order. The count is cleared when a ticket leaves the queue and when it next joins, and priority is read live, so reprioritising a waiting ticket reorders it at the next admission.

A wall-clock window was rejected. The queue drains slowly enough that a queue five deep makes most waiting tickets more than an hour old; an age rule would rank all of them ahead of a fresh critical and reproduce exactly the VS-388 delay it was meant to remove. Time spent waiting in a slow queue is not evidence of being bypassed. A bypass count is.

The queue report carries each waiting entry's `priority` and an `ahead` flag for an entry ordered before an earlier-joined lower-priority ticket. V1's merge-queue page labels a jumped-ahead row with its priority; V2's Work strip names the ticket the rule would admit next and, when it jumped ahead, its priority.

## Consequences
- Supersedes ADR 0006's first-in-first-out consequence. ADR 0006's concern does not apply: a ticket is admitted only when a slot frees, and admission re-syncs the branch with its landing branch, so a jumped ticket rebases again at admission — the same work it would have done without the jump.
- A critical can still wait behind the merge currently in flight and behind a ticket that has been bypassed three times; the wait is bounded by the bypass rule rather than by queue depth.
- One additive column, no backfill: every existing ticket reads as zero bypasses, and an older daemon ignores the column and merges in join order again.
- The waiting order is a pure function of queue state in `packages/shared` (`compareMergeQueue`), used by both the daemon and the web app, so what the strip names is what the queue admits.
