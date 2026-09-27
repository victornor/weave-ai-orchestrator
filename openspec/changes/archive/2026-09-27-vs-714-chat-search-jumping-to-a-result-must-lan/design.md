## Context

`packages/ui/src/v2/ChatPage.tsx`'s `JumpView` (added by VS-320) replaces the whole conversation with
the one-shot result of `useMessageContext` (`GET /threads/:id/messages?around=<id>`,
`packages/core/src/threads/service.ts:around()`, a bounded window of 25-before/24-after around the
target). VS-320's own design explicitly scoped this as a **non-goal**: "Forward (\"load newer\")
pagination from an arbitrary anchor point. The anchored view loads one bounded window around the
target; returning to the live tail is a single dedicated action, not incremental forward paging."
Captain is now asking for exactly that reversed: free scrolling both ways, no dead end, "back to
latest" as a convenience only. This change supersedes that non-goal.

`useThreadMessages` (`packages/ui/src/api/hooks.ts`) is a `useInfiniteQuery` that pages backward only:
page 0 is `before: undefined` (the latest `THREAD_PAGE_SIZE` messages), and `getNextPageParam` always
asks for an older page via `before`. Its pages array is fetched oldest-appended-last and rendered via
`[...pages].reverse().flat()`. `ChatConversation`'s `onJumpTo` already does exactly the scroll-and-
highlight work a jump needs (`packages/ui/src/v2/ChatConversation.tsx:268-292`) — today only reachable
from a reply's "jump back" link — by finding a `[data-message-id]` node already in the DOM, centring
it in the scroller, focusing it, and marking it briefly (`v2-jump-highlight` / `JUMP_HIGHLIGHT_MS`).
The gap is not scrolling-and-highlighting; it is getting the target message, and everything between it
and the live tail, into the same `rows` this component already renders.

`ThreadsService.search()` (`packages/core/src/threads/service.ts`) and `SpecsService.search()`
(`packages/core/src/specs/index.ts`) both quote every query term through `ftsQuery()`
(`packages/core/src/search/ftsQuery.ts`) and `MATCH` against an FTS5 table using the default
`unicode61` tokenizer, which separates on non-alphanumeric characters (`_` included). Tokenization
happens identically for the indexed document and for a `MATCH` phrase, so quoting `_password` does not
help: the phrase itself tokenizes down to `password`, matching any message that merely contains
"password". `ftsQuery`'s own stripped-character set (`["'^*:()[]{}~+-]`) exists to keep those characters
from being read as FTS5 *operators*, not to fix tokenizer-caused over-matching — a separate concern
this change addresses.

## Goals / Non-Goals

**Goals:**
- Jumping to a search result — however far outside the loaded window — lands in the one scrollable
  conversation, with older and newer messages loadable from there with no dead end.
- A query containing a character the tokenizer discards no longer silently over-matches; it requires a
  literal, case-insensitive substring match. Plain-word queries are byte-for-byte unaffected.

**Non-Goals:**
- A trigram or other secondary index for literal matching. The ticket names this as an option but the
  FTS-prefilter-then-substring-check approach it also names is sufficient at this workspace's message
  volumes and requires no schema migration.
- Ranking/relevance changes beyond what literal filtering removes. Order stays "newest first" for
  thread search (unchanged) and FTS `rank` for spec search (unchanged).
- Reworking `useStickToBottom`'s bottom-follow mechanics for the live tail. The existing
  follow/pause/`ScrollToBottomButton` machinery already does the right thing once the anchored window's
  content reaches the same shape as the tailing one; this change only adds a second, symmetric loading
  direction feeding the same `rows`.
- Multi-term literal matching nuance (e.g., requiring `_` in one term of a multi-word query but not
  another). The literal check is applied to the whole trimmed query string against the message body,
  which is what the ticket's own scenarios (`_password` vs `password`) need.

## Decisions

**Fold the anchored window into `useThreadMessages` itself, not a parallel query.** Rather than keep
`useMessageContext` as a separate one-shot read powering a separate view, `useThreadMessages(id,
anchor?)` takes an optional message id. `anchor == null` is exactly today's tailing behavior (same
query key, same cache, no behavior change — verified by not touching its existing tests). A non-null
anchor is a different query key (`qk.threadMessages(ws, id, anchor)`), so switching back to `null`
(the "Jump to latest" convenience) reuses or cheaply re-fetches the original tailing query rather than
discarding useful cache — matching VS-320's original "revert to the tailing view unchanged" property,
now just optional rather than mandatory.

**Bidirectional `useInfiniteQuery` via `getNextPageParam`/`getPreviousPageParam`.** TanStack Query v5
(already a dependency) supports paging in both directions on one query. Page params become a small
discriminated union:
- `{ kind: 'latest' }` — the initial param when `anchor` is null; `queryFn` calls `messages({})`.
- `{ kind: 'around'; id }` — the initial param when `anchor` is set; `queryFn` calls `around(id)`.
- `{ kind: 'before'; cursor }` — `queryFn` calls `messages({ before: cursor })`; produced by
  `getNextPageParam` from the oldest message of the current last-appended page, exactly as today.
- `{ kind: 'after'; cursor }` — `queryFn` calls `messages({ after: cursor })`; produced by
  `getPreviousPageParam` from the newest message of the current first-in-array page.

`fetchNextPage` (older) appends to the pages array; `fetchPreviousPage` (newer) prepends. Since the
final `data` is built by reversing the whole pages array and flattening, an appended (older) page ends
up before everything, and a prepended (newer) page ends up after everything — the array's insertion
order does the reordering for free, with no change to the existing reverse-and-flatten line.
`getPreviousPageParam` returns `undefined` once an `after` fetch comes back shorter than a full page
(no more messages exist past what is loaded) — that is `hasNewer` reaching false, i.e. caught up to the
live tail. For `anchor == null`, `getPreviousPageParam` always returns `undefined` (there is no
"newer than latest" direction), so `hasNewer` is always false in tailing mode, matching today.

**`after` on `ThreadsService.messages()`, not a second bespoke query.** Mirrors the existing `before`
branch: `WHERE m.created_at > ? ORDER BY m.created_at ASC, m.rowid ASC LIMIT ?`, already ascending so
no `.reverse()` is needed (unlike the `before` branch, which queries DESC for `LIMIT` correctness and
reverses after). The route rejects `after` combined with `before` or `around`, the same shape as the
existing `around`/`before` exclusivity check.

**Live updates while anchored fall out of the existing invalidate-and-refetch path, unchanged.**
`thread.message` events already invalidate `qk.threadMessages(ws, id)` as a *prefix* — an anchored
query's key (`[...threadMessages(ws,id), anchor]`) still matches that prefix, so it refetches too.
Refetching an infinite query re-runs every already-fetched page's `queryFn` with its recorded param;
an `after`-page's cursor is a fixed instant, so re-running it after a new message arrives simply
returns everything past that instant now, including the new message. No new invalidation code is
needed — this is the same mechanism that already keeps the plain tailing view current.

**`ChatConversation` exposes `jumpTo(id)`, generalizing the existing internal `onJumpTo`.** The
internal callback already does the scroll/highlight/pause work; it is invoked today only from a
reply's own "jump back" link. Adding it to `ChatConversationHandle` lets `ChatPage` drive the same path
for a search result. Because the DOM node for an anchor's target may not exist yet on the same render
the anchored data arrives (React hasn't committed the new rows), `ChatPage` retries the `jumpTo` call
in an effect keyed on the anchor and the loaded message ids, firing once the target is actually
present — the same "wait for it to mount" problem `onJumpTo`'s own `querySelectorAll` already tolerates
by simply no-op'ing if the node isn't there yet, just invoked from outside instead of from a click.

**A `newer` counterpart to `OlderPages` in `useStickToBottom`, mirroring the existing top trigger.**
`NEAR_TOP_PX`/`anchor.current`'s "measure distance from top, ask for an older page, restore that
distance once it lands" pattern has no equivalent restoration problem on the bottom side — a page
appended at the *end* of the visible list doesn't shift anything above the viewport, so `loadNewer()`
only needs a `NEAR_BOTTOM_PX` trigger with no compensating scroll-position math. `follow`/`atBottom`
already handle "is the human actually at the live edge" for the tailing case; the anchored case simply
grows towards it.

**Remove `JumpView` and `useMessageContext` outright.** Both exist only to serve the frozen-slice
behavior this change replaces; nothing else references them.

**Literal-match helper, shared by both search call sites.** A new predicate,
`needsLiteralMatch(query): boolean` (true when the trimmed query contains any character outside
`[A-Za-z0-9\s]`), and a builder, `literalSnippet(body, needle, contextChars)`, both live in
`packages/core/src/search/` next to `ftsQuery` since both search implementations already import from
there. `ThreadsService.search()` and `SpecsService.search()` keep their existing `ftsQuery()`-driven
`MATCH` as the candidate lookup (a safe superset — the FTS tokenization of `_password` already matches
every candidate that could possibly contain `_password` literally, since it degrades to matching
`password`), over-fetch a larger candidate limit when `needsLiteralMatch` is true (capped at each
service's own existing max, e.g. `SEARCH_MAX_LIMIT`), filter candidates to those whose raw body
contains the trimmed query as a case-insensitive substring, then slice to the requested limit. The
existing `snippet()` SQL function is FTS-token-relative and would highlight `password`, not
`_password`; the literal-match path instead selects the raw body column already present in each
table's underlying row and builds the snippet in code — locate the case-insensitive substring index,
carve a bounded character window around it with `…` truncation markers, and wrap the exact matched
substring in the same `\u0002…\u0003` delimiters `snippet()` already used, so
`SearchPanel.tsx`'s existing delimiter-splitting renderer needs no change.

**Over-fetch, not a full re-query loop, when literal-filtering shrinks the candidate set.** Fetching a
capped larger candidate window (rather than iteratively re-querying with ever-larger limits) is a
pragmatic bound: it can under-return on a query whose FTS-tokenized form is extremely common relative
to how rarely it appears with the exact punctuation (worst case, fewer than the requested `limit`
literal matches surface even though more exist further back). Documented as an accepted limitation
below rather than solved with unbounded retry, since the ticket's own acceptance criteria only requires
correctness of what is returned, not exhaustiveness under an adversarial corpus.

## Risks / Trade-offs

- [Literal-filter over-fetch can under-return on a pathological corpus] → Acceptable at this
  workspace's data volumes; a future ticket can add a retry-with-larger-limit loop if it is ever
  observed in practice.
- [An anchored `around()` page's `hasNewer`/`hasOlder` recompute after a refetch uses only that page's
  length against the page-size heuristic, which can be off by one at the exact boundary where the true
  tail sits right at the window edge] → Same class of heuristic the existing tailing view already
  accepts (`page.length < THREAD_PAGE_SIZE` as "no more"); not a new risk this change introduces.
- [Removing `useMessageContext` and `JumpView` touches the one existing jump test
  (`packages/ui/src/test/v2chat.test.tsx`, "jumps the conversation to a chosen search result")] →
  Rewritten as part of this change to assert the target renders inside the normal scrollable
  conversation (highlighted, in view) rather than a separate "Jumped to a message" banner.

## Migration Plan

No database migration: `after` is a new query parameter over the existing `thread_messages` table and
index, and the literal-match filter is applied in application code after the existing `MATCH` query.
Purely additive; no rollback concern beyond a normal code revert.
