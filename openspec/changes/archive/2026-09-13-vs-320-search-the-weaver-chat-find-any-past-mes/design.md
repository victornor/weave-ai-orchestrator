## Context

`thread_messages(id, thread_id, direction, author_kind, author_id, run_id, body, parts_json,
external_message_id, delivery_status, created_at)` (`packages/db/src/migrations/0001_init.sql`) has
no full-text index; it is indexed only on `(thread_id, created_at)`. `channel_threads` has no
`workspace_id` column of its own — a thread belongs to a workspace only through
`channel_threads.channel_id → channels.workspace_id`. `ThreadsService`'s existing reads
(`messages()`, `message()`, `attachment()`) all resolve scoping through a private `get(threadId)`
helper that joins `channel_threads` to `channels` and filters on `c.workspace_id = ws`, throwing
`not_found` for a thread outside the caller's workspace (`packages/core/src/threads/service.ts:80-87`).
That is the existing scoping contract this change extends, not a new one.

`packages/core/src/knowledge/service.ts` and `packages/core/src/specs/index.ts` both already write
into one shared FTS5 virtual table, `knowledge_search(kind, project_id, ref, title, body)`
(`packages/db/src/migrations/0001_init.sql:191`), discriminated by a `kind` column (`'knowledge'`,
`'spec'`, `'change'`). `ftsQuery()` (`packages/core/src/specs/index.ts:147`) strips FTS5 operator
syntax and quotes each remaining term; `specs/index.ts`'s `search()` is the reference for querying it
(`MATCH` + `snippet(...)` + `ORDER BY rank`).

On the client, `useThreadMessages` (`packages/ui/src/api/hooks.ts:1569`) is a `useInfiniteQuery`
keyed by `qk.threadMessages(ws, id)`, paging backward only (`getNextPageParam` always returns an
older cursor; there is no forward/"newer" pagination direction today). `Chat.tsx`'s stick-to-bottom
behavior (`useStickToBottom`, `packages/ui/src/lib/stickToBottom.ts`) already has a documented history
of regressions (VS-63, VS-79, VS-197) and is treated in this design as something to route around, not
touch.

## Goals / Non-Goals

**Goals:**
- Full-text search over an entire thread's stored history, safe against operator syntax, scoped
  server-side the same way existing thread reads are.
- A way to view a specific old message in its surrounding context without disturbing how the live
  tail behaves once the human returns to it.

**Non-Goals:**
- Changing `useThreadMessages`'s tailing/pagination behavior itself, or `useStickToBottom`'s
  mechanics. The anchored ("jumped-to") view is a separate, parallel read path that the live view
  reverts to unchanged.
- Forward ("load newer") pagination from an arbitrary anchor point. The anchored view loads one
  bounded window around the target; returning to the live tail is a single dedicated action, not
  incremental forward paging (matches proposal/spec: "one action" back to latest).
- Ranking/relevance tuning beyond FTS5's default `rank`; matching the existing `specs/index.ts`
  reference implementation is sufficient.
- Indexing `parts_json` (attachment metadata) or run traces/transcripts — out of scope per the ticket.

## Decisions

**A dedicated FTS5 table, not reusing `knowledge_search`.** `knowledge_search` has no `thread_id` or
`workspace_id` columns — only `project_id`, which means nothing for a thread message. Shoehorning
scoping into `ref` (e.g. `ref = 'message:<threadId>:<messageId>'` with a `LIKE` prefix) would defeat
FTS5's own indexing for the columns that actually need to be filtered and would conflate two
unrelated content lifecycles (curated knowledge documents vs. an append-only message log). A new
table, `thread_message_search(message_id UNINDEXED, thread_id UNINDEXED, workspace_id UNINDEXED,
body)`, keeps `thread_id`/`workspace_id` as real filterable (if unindexed-for-FTS) columns, mirrors
`knowledge_search`'s "explicit content table, not `content=` linked" shape, and does not touch a table
two other features already depend on. `workspace_id` is denormalized onto the row at insert time
(read once from `channel_threads`/`channels` via the existing `get()` helper) so a search query never
needs the three-way join — it filters `thread_id = ? AND workspace_id = ?` directly, then `MATCH`.

**Extract `ftsQuery()` rather than importing it from `specs/index.ts`.** Two independent features
importing a sanitiser out of a third feature's module is a layering smell (`threads` would depend on
`specs` for an unrelated utility). Moving it to `packages/core/src/search/ftsQuery.ts` and updating
`specs/index.ts`'s own import is a small, mechanical, behavior-preserving refactor — still exactly one
implementation, per the ticket's explicit instruction not to write a second one.

**Index on write, not via a background job.** `insertMessage()` is the single write path for both
`inbound` and `outbound` (`packages/core/src/threads/service.ts:89`), already inside a `tx(db, ...)`
transaction at each call site. Inserting the search row in the same transaction keeps the index
exactly as current as the message itself, with no separate reindex step to forget or fall behind on —
directly satisfying "new messages are indexed as they are written."

**`search()` scoped through the existing `get(threadId)` helper, throwing the same `not_found`.**
`messages()`, `message()`, and `attachment()` already treat a cross-workspace thread id as `not_found`
rather than an empty result with a 200. Matching that (rather than inventing a bespoke "return empty
array" behavior for search alone) is what the proposal means by "scoped the way `messages()` is" —
one behavior for "this thread isn't yours," not two.

**Jump-to-message: a bounded window via a new `around` read, not a stateful cursor.** The simplest
model that satisfies "loads the surrounding history, scrolls it into view" without also having to
solve bidirectional infinite scrolling: `ThreadsService.around(threadId, messageId, opts?: { before?:
number; after?: number })` returns one page (defaults: 25 before + the target + 24 after, capped the
same way `messages()` caps `limit`) via two queries reusing `messages()`'s existing ordering —
`(created_at, rowid) <= (target.created_at, target.rowid)` DESC LIMIT before+1, and `(created_at,
rowid) > (target.created_at, target.rowid)` ASC LIMIT after — merged and returned oldest-first.
`messages()` itself orders by `created_at DESC, rowid DESC`; comparing `created_at` alone here would
risk dropping the target from its own window, or repeating or skipping a neighbour, whenever two
messages share a millisecond (a relayed answer and its echo are written together and do exactly
that). On the client this becomes a second, one-shot
query (not another `useInfiniteQuery`) that temporarily replaces what `Chat.tsx` renders; "back to
latest" simply discards that query's result and re-renders the existing, untouched
`useThreadMessages` tailing view. `messages.data` already exists and is unmodified for that return
path, which is what keeps "new messages behave as they do today" true without new code in
`stickToBottom.ts`.

**Highlight-and-scroll via a plain ref map, not the decision-card `IntersectionObserver` machinery.**
`Chat.tsx`'s `register`/`useOnScreenDecisions` (`packages/ui/src/routes/Chat.tsx:348,1096-1104`) exists
to track which decision cards are on-screen for pinning — an unrelated concern. Jump-to-message needs
only "find this message's DOM node once it is rendered, scroll to it, add a highlight class, remove it
after a timeout" — a `Map<messageId, HTMLElement>` populated by a ref callback on each rendered
message row is sufficient and keeps this feature's DOM bookkeeping independent of the decision-pinning
one.

**Keyboard shortcut: `⌘⇧F` / `Ctrl⇧F`, bound only while the chat view is mounted.** The ticket is
explicit that the browser's own find (`⌘F`/`Ctrl+F`) must keep working when the chat isn't focused —
and, read narrowly, even a shortcut that only fires while the chat has focus should not claim the bare
find combo, since a human's muscle memory for "find in this page" must not silently behave differently
depending on which app view happens to have focus. Reusing the existing `useHotkeys`
(`packages/ui/src/lib/hotkeys.ts`) with `{ key: 'f', meta: true, shift: true }` — the same pattern
already used for `⌘⇧M` push-to-talk in this same view — avoids the collision entirely while staying
inside the app's established shortcut convention. The visible search button is the primary, always
discoverable affordance on both desktop and phone layouts; the shortcut is a convenience on top of it.

## Risks / Trade-offs

- [Denormalized `workspace_id` on `thread_message_search` could drift if a thread were ever
  reassigned to a different channel/workspace] → No code path today reassigns a thread's channel or a
  channel's workspace after creation; if that ever changes, it is a pre-existing invariant the rest of
  `ThreadsService` also assumes (`channel_threads` rows are never re-parented). Not a new risk this
  change introduces.
- [FTS5 `snippet()`/`highlight()` highlight markers must survive JSON → UI rendering without being
  HTML-escaped into visible artifacts or, conversely, without opening an injection path] → Follow
  `specs/index.ts`'s existing pattern exactly: return snippet markers as a distinct delimiter (not raw
  HTML) and let the UI render the highlight as a React element, never `dangerouslySetInnerHTML`.
- [A very large backfill (thousands of messages across all threads) run inline in the migration could
  be slow on a large workspace] → 2,062 messages in the largest known thread is small for a single
  `INSERT ... SELECT` in SQLite; no batching is needed at this scale. If a future workspace grows
  substantially larger, that is a separate performance ticket, not a reason to complicate this one.
- [Two features (`specs` and `threads`) depending on the extracted `ftsQuery` module] → This is the
  intended outcome, not a risk to mitigate; a shared, tested sanitiser is safer than two.
- [VS-321 (lost text selection) is also working in `routes/Chat.tsx` concurrently] → Rebase onto it if
  it lands first, and make sure the anchored (jumped-to) view's rendering does not remount the message
  rows VS-321 may be fixing selection behavior on — the ref-map approach in the previous decision
  attaches to rows as rendered rather than replacing them, so this should compose rather than conflict,
  but re-check once VS-321's actual diff is visible.

## Migration Plan

- New migration file: **`0033_thread_message_search.sql`** — not `0032`: VS-316 (the restart fix) has
  an approved plan already claiming `0032_…`, on a branch that isn't pushed yet, so `main` still looks
  free at `0032` to a plain re-check. Take `0033` regardless of what a fresh listing of `main` shows.
  If VS-316 has somehow not landed by this change's delivery and nothing else has claimed `0033`,
  keep `0033` anyway rather than re-deriving the number from `main` at that point.
- The migration (a) creates `thread_message_search` and (b) backfills it in the same file with one
  `INSERT ... SELECT` joining `thread_messages → channel_threads → channels` for `workspace_id` — no
  separate backfill script or later migration.
- No rollback script is added, consistent with this codebase's other migrations — SQLite migrations
  here are forward-only; `daemon rollback` restores from a pre-upgrade database backup instead
  (see `release-and-upgrade`).
- No downtime concern: the new table is additive, and `insertMessage()`'s new index-on-write is
  additive within an existing transaction — no existing write path's shape changes.
