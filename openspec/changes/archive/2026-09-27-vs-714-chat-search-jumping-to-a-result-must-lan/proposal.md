## Why

Chat search drops the human into a frozen, non-scrollable slice of the conversation (`JumpView`) with
only a "Back to latest" exit, and a query containing punctuation the search tokenizer discards — e.g.
`_password` — matches every message containing `password`, because FTS5's default tokenizer treats
`_` as a word separator at match time regardless of how the query was quoted.

## What Changes

- A search result now opens in the normal scrollable conversation, scrolled to and briefly
  highlighting the target message, with older messages loading on scroll-up and newer messages
  loading on scroll-down through to the live tail — no dead-end slice. `JumpView` and the one-shot
  `useMessageContext`/`around`-only read it stood in for are removed; the conversation's own paged
  history (`useThreadMessages`) is extended with a "jump to an arbitrary message" seed and a "load
  newer" direction, alongside the existing "load older" one. A "Jump to latest" affordance remains as
  a convenience, not the only way back to the tail.
- `ThreadsService.messages()` gains an `after` cursor (mirroring the existing `before` one) so the
  client can page forward from an anchored window toward the live tail; the route validates `after` is
  not combined with `before` or `around`, the same way `around` already excludes `before`.
- Thread search treats a query containing a character the tokenizer discards (`_`, `.`, `-`, `/`, `@`,
  and other non-alphanumeric characters) as needing a literal, case-insensitive substring match against
  the message body, in addition to the existing FTS candidate lookup — so `_password` only returns
  messages that literally contain `_password`, while plain word queries (e.g. `password`) are
  unaffected. The result snippet highlights the literal match. Spec/change search (`specs/index.ts`)
  gets the same treatment since it shares `ftsQuery()` and the `snippet()` pattern, as long as it does
  not disturb existing spec-search tests.

## Capabilities

### Modified Capabilities
- `conductor-chat/message-jump`: a search result now opens the normal scrollable conversation itself
  (not a separate frozen view), scrolling continues in both directions with no dead end, and returning
  to the live tail is a convenience action rather than the only way to leave the jumped-to context.
- `conductor-chat/message-search`: a query containing tokenizer-dropped punctuation must match the
  query text literally, not just its tokenized form.

## Impact

- `packages/core/src/threads/service.ts` — `messages()` gains an `after` cursor; `search()` adds a
  literal-match post-filter and a manually built snippet for punctuation-bearing queries.
- `packages/server/src/routes/threads.ts` — `after` query param, validated against `before`/`around`.
- `packages/core/src/specs/index.ts` — same literal-match treatment in `search()`, reusing the shared
  helper, if compatible with its existing tests.
- `packages/core/src/search/ftsQuery.ts` (or a sibling module) — a shared "does this query need a
  literal match" / literal-snippet helper used by both search call sites.
- `packages/ui/src/api/hooks.ts` — `useThreadMessages` takes an optional anchor and supports
  bidirectional paging (older via `before`, newer via `after`, seeded via `around` when anchored);
  `useMessageContext` is retired.
- `packages/ui/src/lib/stickToBottom.ts` — a `NewerPages` counterpart to the existing `OlderPages`,
  triggering `loadNewer()` near the bottom of the loaded window the same way `loadOlder()` triggers
  near the top.
- `packages/ui/src/v2/ChatConversation.tsx` — accepts the `newer` paging prop and exposes an
  imperative `jumpTo(id)` (generalizing the existing internal `onJumpTo`) so a caller can jump to a
  message once it has loaded.
- `packages/ui/src/v2/ChatPage.tsx` — `JumpView` removed; `SearchPanel`'s `onSelect` either scrolls to
  an already-loaded message or seeds the anchor and waits for the target row to mount before jumping.
