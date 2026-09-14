## Context

See `proposal.md` — Why. The queue lives in `packages/core/src/tickets/merge-queue.ts`. `waitingOf` reads waiting tickets with `ORDER BY merge_queued_at, number` (`QUEUE_ORDER`), and both `positionOf` and `forProject` derive positions from that order; `pump` iterates the same list and admits the head. Every path into `merging` goes through `join`, so the ordering change is confined to `waitingOf` plus the admission loop that already consumes it.

Three constraints shape the change:

- `packages/ui` must not re-implement the ordering rule, or the strip it shows will drift from what the daemon admits. `packages/ui` imports `@weave-ai/shared` but not `@weave-ai/core`.
- ADR 0006 chose first-in-first-out explicitly, with a stated reason ("re-ordering the landing step would let a high-priority ticket jump a branch that has already rebased onto the current default branch"). That reason is weaker than it reads: a ticket is admitted only when a slot frees, and admission is exactly when the worker re-syncs its branch with the landing branch, so a jumped ticket only rebases again at admission.
- Starvation must not be measured by wall-clock age. This queue drained at roughly one merge per fifteen minutes on 2026-09-14, so a queue five deep makes most waiting tickets more than an hour old; an age-based rule would rank all of them ahead of a fresh critical and reproduce the bug the ticket exists to fix. Waiting is not the same as being bypassed.

VS-391 (PR #327, in `merging`) also edits `mergeStrip` in `packages/ui/src/lib/board.ts` and the V2 Work strip, adding an active-merge wait suffix (`· waiting on CI 3m`). That is a code collision, not a spec conflict.

## Goals / Non-Goals

**Goals**

- A critical fix approved after mediums is admitted next, while a low-priority ticket cannot be passed over indefinitely.
- Starvation measured by actual bypasses, so a slow queue keeps priority meaningful.
- One ordering rule, used by the daemon for admission and by the web app for the "next" hint.
- The active merge step is untouched by the change.
- The queue report and V1 view make a jumped-ahead order legible.

**Non-Goals**

- Pre-empting an active merge, or a per-project/configurable bypass limit (a fixed constant is enough and keeps the surface small).
- Reconstructing bypass counts from history instead of storing them.
- A new V2 merge-queue route: V2 keeps its shell contract, and the Work strip is its only queue surface.

## Decisions

### Order waiting tickets by priority rank, then join time, then number

`critical` = 0, `high` = 1, `medium` = 2, `low` = 3. Among equal ranks, `merge_queued_at` ascending, then `number`. This is the ticket's requested order and is stable: a ticket keeps its relative place among its equals.

Alternative considered: age every ticket one rank per interval. Rejected — the rank a ticket shows would change over time, which is hard to explain in the UI and to test, and it makes "equal priorities keep join order" untrue after an interval.

### Starvation by bypass count, limit three, persisted on the ticket

At each admission, every waiting ticket of the project that joined earlier than the admitted ticket has its `merge_bypasses` incremented by one. A waiting ticket with `merge_bypasses >= MERGE_BYPASS_LIMIT` (3) is **starved**: starved tickets sort before non-starved ones, and among themselves by join time, then number. Non-starved tickets sort by priority, then join time, then number. The count is cleared when the ticket leaves the queue and when it next joins.

This bounds how long any ticket can be bypassed: after three higher-priority (or otherwise later-joined) admissions, the ticket outranks every non-starved ticket. A queue that is merely slow credits nothing, so six long-waiting mediums do not outrank a fresh critical — the VS-388 case stays fixed.

Three is chosen as a small, memorable bound: it lets priority reorder a few places without letting a stream of urgent work starve the tail, and it is a named constant in one place if it needs to move. Alternative considered: one bypass — too eager, a single critical would reset the tail's position before priority can do its job. Alternative considered: a fraction of the queue depth — needs a live queue size in a pure comparator and is harder to reason about.

### Store the count in a `tickets.merge_bypasses` column

Add `0039_ticket_merge_bypasses.sql`: `ALTER TABLE tickets ADD COLUMN merge_bypasses INTEGER NOT NULL DEFAULT 0;`. A dedicated column, not `delivery_json` — the count is queue state, and `delivery_json` holds the PR/CI facts. `Db`'s `camel()` mapping exposes it as `mergeBypasses` on every ticket row, so the ticket list carries it with no extra route, and `Db.update` snake-cases it for the writes. The migration is additive; an older daemon simply ignores the column.

### One comparator in `packages/shared`, consumed by both `core` and `ui`

Add `packages/shared/src/merge-queue.ts`:

- `MERGE_BYPASS_LIMIT = 3`
- `mergePriorityRank(priority): number`
- `mergeQueueJoinedAt(entry): number` — epoch millis, `null` join time treated as earliest (the pre-upgrade path)
- `isMergeStarved(entry): boolean` — `mergeBypasses >= MERGE_BYPASS_LIMIT`
- `compareMergeQueue(a, b): number` — pure, no clock: starved first, then priority, then join time, then number

`core`'s `waitingOf` selects the rows with SQL and sorts them with `compareMergeQueue`; the `ui`'s `mergeStrip` uses the same comparator to pick the next ticket. Because the comparator is pure and takes the bypass count as input, it needs no clock, and the daemon and the web app cannot drift. The ticket list already exposes `mergeBypasses`, so the strip uses the full rule rather than a fallback.

Alternative considered: order in SQL with `CASE` expressions. Rejected — SQLite cannot share the comparator with the web app, so the UI would duplicate the rule.

Alternative considered: put the comparator in `packages/render`. Rejected — `core` does not import `render`; the rule is domain behavior both tiers need, which is `shared`'s role.

### `MergeQueueEntry` carries `priority` and `ahead`

`entry()` gains the ticket's `priority`, and `forProject` marks a waiting entry `ahead` when some other waiting ticket of the same project joined earlier and holds a lower priority. `ahead` is deliberately priority-only: a starvation promotion is a different fact, and labelling a low-priority starved ticket "low" as a reason would mislead. The ticket page's `mergeQueue: { position, concurrency }` needs no new field; its position already follows the new order.

Alternative considered: a richer `reason: 'priority' | 'starved'`. Rejected as more shape than the two surfaces need; the V1 label is the priority word, and a starved ticket's bypassed position is legible from the order itself.

### V2 strip: name who is next, keep one line

`mergeStrip` returns the existing `{ landing, waiting }` plus `next: { identifier, priority, ahead } | null`, computed over the loaded tickets with `compareMergeQueue`; `Work.tsx` renders `· next: VS-123 (critical, jumped ahead)` or `· next: VS-123`. The next ticket is the first across the loaded set under the same comparator (the strip counts are already workspace-wide, so a workspace-wide "next" matches how the strip reads). After VS-391 lands the line also carries the active-merge wait suffix; the string is composed from both parts and the container keeps the strip's existing truncation.

### Record the departure from ADR 0006

Add `docs/adr/0021-merge-queue-priority.md` superseding ADR 0006's FIFO consequence, restate the rebase-at-admission argument, describe the bypass rule, and add a pointer from ADR 0006. Update `docs/PLAN.md` §11.4's "admits waiting tickets in join order (ties broken by ticket number)" to the priority rule and the bypass limit. `docs/API.md`'s `MergeQueueEntry` line gains `priority` and `ahead`.

## Risks / Trade-offs

- **The strip's "next" can disagree with the daemon if the loaded ticket set is stale.** → Both call the same pure comparator over the same `mergeBypasses` value; the strip carries the same tickets the board shows. The daemon remains the authority for admission; the strip is a hint.
- **A jump-ahead can still move an earlier ticket's position after it has already rebased.** → Admission re-syncs the branch anyway (PLAN §11.4), so the jumped ticket rebases again at admission; this is the same work it would have done without the jump.
- **A fixed bypass limit of three may be too eager or too lax for a project's mix.** → It is a named constant in one place (`shared`), documented in the ADR, and changing it is a one-line follow-up.
- **Bypass counts could drift if an admission path did not go through `pump`.** → `admit` is the single writer of `merge_started_at`; the increment belongs in the one loop that admits in `pump`, and `join` resets the count, so a stale count cannot survive a re-entry.
- **VS-391's edit to `mergeStrip` and `Work.tsx` conflicts textually.** → Rebase `ac/vs-390-…` onto main once VS-391 lands and keep both the wait suffix and the next-ticket hint on the one line; both test files can be merged by keeping both assertions.

## Migration Plan

Migration `0039_ticket_merge_bypasses.sql` adds `merge_bypasses INTEGER NOT NULL DEFAULT 0`; every existing ticket reads as zero bypasses, which is exactly a fresh queue. No backfill and no rollback hazard: an older daemon ignores the column and merges in join order again. Ordering is derived at read time, so no other data moves.

## Open Questions

None.
