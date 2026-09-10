## Context

See `proposal.md` for the confirmed root cause (two `EventSource` connections per workspace on
`/chats`: one from `AppShell`'s `FanInStreams`, one from each pane's own `WorkspaceProvider`).

Two independent stream sources exist per pane today, not one:

1. `WorkspaceProvider`'s `EventStream` (`packages/ui/src/api/context.tsx`) — the workspace-wide
   event feed (`GET /api/w/:ws/events`), used for cache invalidation plus two direct
   `useWorkspaceEvents` listeners in `ChatPage` (tracking `run.started`/`run.finished` for the
   live-turn block, and re-showing a hidden decision on `ticket.comment`).
2. `useRunEventStream` (`packages/ui/src/api/runStream.ts`), which opens its own separate
   `EventSource` (`GET /api/w/:ws/runs/:id/events/stream`) whenever `ChatPage` believes a turn is
   running (`live?.running`). This is independent of (1) — it is not gated by whether
   `WorkspaceProvider` has a stream, only by `ChatPage`'s own `live` state, which is itself set
   from a *polled* query (`useConductor`), not only from stream events. So even removing every
   `WorkspaceProvider` duplicate leaves a second, per-pane connection source that still scales
   with how many workspaces happen to have an active conductor turn at once.

There is no server endpoint that streams more than one workspace over one connection — `GET
/api/w/:ws/events` is scoped to a single `:ws` (`docs/API.md:29`) — so "one shared connection
multiplexed by workspace" is not available without adding a new server route, which is a
larger, separately-scoped change (see Decisions).

## Goals / Non-Goals

**Goals:**
- Bound the number of persistent connections `/chats` opens to a small constant, independent of
  how many workspaces are listed — not just lower than today's count.
- Every pane still shows its workspace's conductor chat and can still send into it.
- `/w/:ws/chat` (single-workspace chat) is byte-for-byte unaffected.

**Non-Goals:**
- A server-side multi-workspace stream endpoint. Worth doing eventually (it would let every pane
  stay fully live at any workspace count with one connection total), but it is new API surface,
  a new server route, and a new client transport — larger than fixing a page that currently never
  loads. Flagged as a follow-up, not built here.
- Redesigning single-workspace chat, or `FanInStreams`'s use on `/needs`, `/live`, `/incidents`,
  `/map` — those pages don't render N full `ChatPage` instances and aren't reported broken; only
  `/chats`'s own `FanInStreams` usage is removed, since the focused-pane mechanism supersedes it
  there.

## Decisions

**One focused (live) pane, not visibility-based (IntersectionObserver) gating.** Considered
gating liveness by which panes are actually scrolled into view. Rejected: still scales with
however many panes fit in the viewport (not obviously bounded on an ultrawide monitor with narrow
panes), needs real layout geometry the test environment (jsdom) cannot produce, and the resulting
behavior — several panes live at once, the set changing as you scroll — is harder to reason about
and to explain to the human than "one pane is live; click a header to change which one." A single
focused pane is a hard O(1) bound regardless of viewport width or workspace count, and is
straightforward to test (assert the connection count, not pixel geometry).

**`WorkspaceProvider` gets a `live` prop; `ChatPage` gets a `focused` prop — both default
`true`.** Keeps every existing call site (`/w/:ws/chat`, and anywhere else `WorkspaceProvider` or
`ChatPage` is used) unchanged. `GlobalChatsRoute` is the only caller that ever passes `false`.
Two separate props rather than one threaded through, because they gate two independent stream
sources (see Context) that happen to both need to be off together for an unfocused pane, but are
owned by different components — `WorkspaceProvider` doesn't know about run streams, and
`ChatPage` doesn't own its own `WorkspaceProvider`.

**`/chats` stops rendering `FanInStreams`.** With one pane always live via its own
`WorkspaceProvider`, `FanInStreams`'s blanket per-workspace fan-out is redundant for the workspace
that's focused, and for the rest it would reintroduce the exact O(workspace count) connection
growth this change removes. The cost: rail/sidebar badges for *other* workspaces (e.g.
`otherWorkspacesNeed` in `AppShell`) go from live to however stale their own query's refetch
interval already tolerates (`useWorkspaces` already polls every 60s — `packages/ui/src/api/hooks.ts:145`
— regardless of any stream) while sitting on `/chats` specifically. Accepted: those badges were
never `/chats`'s job, `needsCount` is already forced to 0 on every global page
(`AppShell.tsx:52`), and a page that loads with 60-second-stale rail badges beats a page that
never loads.

**Focus switch triggers a refetch of the newly-focused workspace's messages and decisions**, not
a reliance on passive cache staleness. `ChatPage` stays mounted (not remounted) for every pane
regardless of focus, so its queries stay "active" and won't spontaneously refetch on a focus
change alone. `GlobalChatsRoute` explicitly invalidates that workspace's `qk.threadMessages` and
`qk.decisions` when it becomes focused, so a pane that missed a reply while unfocused is caught up
immediately rather than waiting out whatever interval its queries happen to have.

## Risks / Trade-offs

- **An unfocused pane's live turn doesn't stream token-by-token.** If Beta's conductor starts a
  turn while Alpha is focused, Beta's pane won't show the streaming transcript live — only the
  static reply, once fetched. Mitigated: the "conductor is working" indicator still appears
  promptly for an unfocused pane's own turn, since that comes from the polled `useConductor`
  query, not the stream; only the live token stream itself is limited to the focused pane. Spec
  delta captures this as the new, intended behavior rather than a silent gap.
- **Rail badges for unfocused workspaces go stale (up to 60s) while sitting on `/chats`.** See
  the `FanInStreams` decision above. Does not affect `/chats` content itself, only the sidebar.
- **Residual scaling limit is not this ticket's to close**: even with `/chats` fixed to O(1), the
  other four global pages' `FanInStreams` usage still opens one connection per workspace. That
  was true before this change and is out of scope here (see Non-Goals) — worth its own ticket if
  workspace counts grow enough to matter there too.
