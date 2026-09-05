## Why

The workspace owner reports that the conductor chat stopped opening at its newest message: it comes
up in the history and the scroll-to-bottom button has to be pressed. VS-39 built the opposite —
the newest page, positioned at the bottom outright, with no animation to sit through.

The cause is one wrong reading of "the history has loaded", and two things built on top of it.

`ChatRoute` finds its thread id in an effect, from a separate `/threads` query, so
`useThreadMessages(null)` is **disabled** on the first renders. A disabled TanStack query is idle
rather than fetching, and `isLoading` is `isPending && isFetching` — so it is already `false` before
there is a thread, let alone a message. `ready: !messages.isLoading`
(`packages/ui/src/routes/Chat.tsx`) therefore told `useStickToBottom` the list had content to open
on while the list was empty. The hook spent its one instant opening jump there and marked itself
opened; when the real history landed it was no longer opening, so it *animated* down from the top
(`packages/ui/src/lib/stickToBottom.ts`).

VS-46's per-workspace reading position then turned that animation into a sticky state:

- The recorder stored every scroll event that was not at the bottom. A smooth scroll fires scroll
  events all the way down, each one short of the bottom, so a frame of the chat's own opening
  animation was stored as the workspace's reading position.
- The restore latched on the same false `isLoading`, so it ran on the empty first render — putting
  a position back against no messages, and leaving nothing for the history when it arrived.
- On the next visit the history is in the query cache and present at mount, so the hook's jump and
  the restore ran in the same commit: the list jumped to the bottom and was immediately pulled back
  up to the recorded offset. An upward move pauses the follow — which is what put the
  scroll-to-bottom button on screen and kept it there.

VS-43's pinned decisions and VS-48's drafts are not involved; the pinned region is outside the
scrolling body and the draft never touches it.

## What Changes

- **`ready` means the history is loaded**, not "not currently loading": `messages.data !== undefined`.
  A list that is not ready is not positioned at all, so the opening jump belongs to the first real
  content whenever it arrives.
- **The hook stops treating a not-ready pass as opened.** `useStickToBottom` returns before scrolling
  while `!ready`, so `opened` cannot be spent on an empty list.
- **A reading position is only one the human chose.** The hook exposes its live `following` ref —
  the same answer as `atBottom`, readable inside the scroll event it has just classified — and the
  recorder keeps an offset only when the follow is paused *and* the list is genuinely away from its
  bottom. Nothing the list scrolled itself is recorded.
- **The restore waits for the history too**, and remembers *which* workspace it restored rather than
  merely that it ran, so a second workspace still gets its own position back.
- **The first render says loading rather than empty.** With no data and no error the chat shows its
  skeleton; it was showing the "Tell me what you need." pitch for a moment on every visit.
- **The scrolling element is attached once.** `attachScroll` depended on the whole `stick` object,
  which is a fresh literal every render, so the ref was detached and re-attached on every commit; it
  now depends on the hook's own stable `scrollRef`.

## Capabilities

### New Capabilities

(None.)

### Modified Capabilities

- `workspace-navigation/sidebar-workspaces`: what counts as the chat's reading position — a position
  the human scrolled to, restored once the history it was measured against is loaded — and that the
  list's own scrolling is never recorded as one.

## Impact

- `packages/ui/src/lib/stickToBottom.ts` — `ready` documented and enforced as "the content this list
  opens on has loaded"; `following` added to `StickToBottom`.
- `packages/ui/src/routes/Chat.tsx` — `ready`, the recorder, the restore, the loading branch and the
  scroll ref.
- `packages/ui/src/test/chat.test.tsx` — the history query can now report "no data yet", and four
  tests cover the opening jump arriving with the history, the follow still animating afterwards, the
  loading state, the follow's own scrolling not being recorded, and the restore waiting.
- No change to `packages/ui/src/lib/chatScroll.ts`, to how history pages are fetched, or to anything
  outside the web app.

## Out of scope

- How history pages are fetched (`useThreadMessages`' cursor, page size and invalidation).
- The other surfaces that follow a bottom — `RunTranscript`, the ticket and Run pages — which pass no
  `ready` and are unaffected.
