## Context

See `proposal.md` — Why. What matters for the approach is what is already in place:

- `router.tsx` mounts a single `wsRoute` at `/w/$ws`, whose component wraps `AppShell` in
  `WorkspaceProvider ws={params.ws}`. Navigating from `/w/a/chat` to `/w/b/board` keeps the same
  route component mounted and only changes the `ws` prop — React Router does not remount the tree,
  so there is no document reload to remove.
- `WorkspaceProvider` (`api/context.tsx`) already does the whole context switch in one effect keyed
  on `ws`: `setWorkspaceId(ws)` (the remembered workspace), `new EventStream(ws, qc)`, and a cleanup
  that stops the previous stream. All workspace-scoped query keys are prefixed `['w', ws, …]`
  (`api/keys.ts`), so a different workspace is a different cache entry, not a cache reset.
- The rail's per-section links are already built from `RAIL` in `app/nav.ts` via
  `href(item, ws)` — the workspace is a parameter, not a mode.
- `GET /api/workspaces` (`packages/server/src/routes/daemon.ts`) returns every loaded workspace with
  `{ id, name, ticketPrefix, root, projects }`. There is no per-user workspace ACL: `authMiddleware`
  authenticates, and every workspace route resolves by `deps.workspaces.get(id)`. "Every workspace
  the human can access" therefore means every loaded workspace.
- Decisions live in each workspace's own SQLite database, with
  `CREATE INDEX decisions_ws_status ON decisions(workspace_id, status)` already present.

So the work is almost entirely in the sidebar's markup and in one new number on an existing
endpoint. The one genuinely new piece of state is what expansion the device remembers.

## Goals / Non-Goals

**Goals**

- Keep the switch mechanism exactly as it is (`WorkspaceProvider`'s effect); change only what the
  sidebar renders, so navigation between workspaces is an ordinary `<Link>`.
- One network cost for the counts regardless of how many workspaces are loaded.
- Keep the sidebar testable without a router: the workspace group is its own component taking data
  as props.

**Non-Goals**

- Any per-user workspace visibility rule. There is none today; inventing one is a separate change.
- Composer draft persistence. VS-48 owns it; see the chat-scroll decision below.
- Prefetching another workspace's data on hover or expand. Expanding a group renders links, nothing
  more; the data loads when the human actually goes there.
- Keeping the previous workspace's event stream alive after a switch.

## Decisions

### The counts come from `GET /api/workspaces`, polled once a minute

Each item gains `needsYou`, computed as
`SELECT COUNT(*) FROM decisions WHERE workspace_id = ? AND status = 'open' AND owner = 'human'` —
covered by `decisions_ws_status`. `useWorkspaces()` gains `refetchInterval: 60_000`, and
`invalidateFor` invalidates `qk.workspaces()` on the four `decision.*` events so the active
workspace's row is corrected immediately as well.

The active workspace's badge is rendered from the existing live `useDecisions({status:'open',
owner:'human'})` query, which the SSE stream already invalidates; the polled number is used only for
the other workspaces. This makes the "live for the active workspace, refreshed for the others"
requirement fall out of what already exists rather than needing new machinery.

*Cost:* one extra HTTP request per client per minute, and N indexed `COUNT(*)` reads per request
(N = loaded workspaces, in practice under ten; each is an index-only count of a table with tens of
rows). Nothing is added to the SSE path.

*Alternatives rejected.* **An SSE stream per workspace** gives instant counts everywhere but opens N
`EventSource` connections against a browser cap of ~6 per origin on HTTP/1.1, and each one costs the
daemon a live subscription and full event fan-out — a large standing cost for a badge.
**A per-workspace `GET /decisions` fan-out from the client** needs no server change but is N requests
per refresh and N query keys, and re-implements on the client what one SQL count does on the server.
**Reusing `GET /api/w/:ws/briefing`** would work but builds five sections of snapshot per workspace
to read one length.

### Expansion state: one localStorage key, active workspace forced open

`packages/ui/src/lib/wsExpansion.ts` reads and writes `conductor.ws.expanded` as a JSON array of
workspace keys, with the same `try`/`catch` discipline as `api/client.ts` (private mode must not
break the sidebar). Absent or unparseable ⇒ empty array ⇒ only the active workspace is open,
because the active workspace is unioned in at render time and rendered without a collapse control.
Unknown keys in the stored array are simply not matched against any workspace and are left alone,
so a workspace that comes back later reopens as the human left it.

*Alternative rejected:* storing expansion in the workspace config on the daemon. It is a per-device
view preference, not workspace state, and would mean a write round-trip per toggle.

### The rail is restructured, the dropdown is deleted

Order becomes: **Start Work** (acts on the active workspace) · the workspace list · **New workspace**
· the `⌘K` footer. Within a workspace group: a header row (name, ticket prefix, Needs-you count, and
a disclosure control for non-active workspaces) and, when expanded, the eight `RAIL` links. The
Projects sub-list stays, nested inside the active workspace's group only — it is the active
workspace's board filters, and a non-active workspace's projects are not loaded (`useProjects`
is workspace-scoped) and would cost a request each to fetch.

The keyboard hint column (`1`–`7`, `,`) renders only in the active group, matching what the
shortcuts actually do.

The dropdown's two functions both survive: switching is the list itself, and **New workspace**
becomes a permanent rail entry. `⌘K`'s "Switch workspace" commands are untouched.

*Alternative rejected:* keeping the dropdown alongside the list. Two controls for one job, and the
design contract's "the rail is the only place all projects appear at once" becomes ambiguous.

### `WorkspaceNav` is a presentational component

`app/WorkspaceNav.tsx` takes `{ workspaces, activeWs, activePath, expanded, onToggle, needsCount,
projects }` and renders the list. `AppShell` owns the hooks. This keeps the new tests free of the
`../api/hooks` wholesale mock that `appshell.test.tsx` uses — the project KB's standing warning that
adding a hook breaks every route test that mocks that module. `appshell.test.tsx`'s existing mock
still gains the new hook shape so it keeps passing.

### Chat scroll: a module-level session store, and no draft handling

`packages/ui/src/lib/chatScroll.ts` holds a `Map<string, number>` of scroll offsets in module scope —
session lifetime, deliberately not persisted. The offset is recorded on unmount from
`stick.scrollRef.current.scrollTop` and restored on mount **only when the stored position was not at
the bottom**; at the bottom, `useStickToBottom` already does the right thing and fighting it would
cancel its own smooth scroll mid-flight (the same failure the project KB records for VS-38).

**The composer is not touched by this change.** Draft persistence belongs to VS-48, which keys it by
workspace *and thread* and backs it with storage. A session-scoped per-workspace draft store here
would be a second source of truth for the same text, and the two would disagree the moment a
workspace has more than one thread. If VS-48 has not landed when this is built, the composer is left
as it is rather than gaining an interim store.

*Alternative rejected:* lifting chat state into a context above the route. Larger blast radius for
one scroll offset.

### Phone: the list goes at the top of Settings

The More tab already targets `/w/$ws/settings`, so putting a Workspaces block at the top of Settings
adds an obvious destination with no new route, no new sheet component and no bottom-bar change. It
is ordinary page content inside `PageBody`, so the 390 px check is the existing bar padding, not new
geometry.

*Alternative rejected:* a header sheet on the chat/board headers — a new component and a new
trigger on every phone screen, for a destination the More tab already reaches.

## Risks / Trade-offs

- **A non-active workspace's count can be up to a minute stale.** → Accepted and specified; the
  active workspace, which is where the human is looking, is live. A decision raised elsewhere also
  still produces its own arrival path when that workspace becomes active.
- **A tall sidebar with many workspaces expanded.** → The workspace list scrolls within the rail
  (`overflow-y-auto` on the list, the `⌘K` footer pinned), so the footer and New workspace never
  scroll away.
- **`appshell.test.tsx` mocks `../api/hooks` wholesale and will break the moment the shell reads a
  new hook.** → Known project landmine; the mock is updated in the same task, and the new sidebar
  tests target `WorkspaceNav` directly rather than adding to that mock.
- **`GET /api/workspaces` does not return `slug`, and the current code already falls back to
  `w.slug || w.id`.** → Left as is; the URL key stays `w.id`, which `deps.workspaces` resolves.
  Changing the payload's identity fields is out of scope for this change.
- **The count query runs per workspace on every list request.** → Indexed count, ~10 workspaces,
  once a minute per client. If the workspace count ever grows past that scale the endpoint can cache
  for a few seconds; not worth doing now.

## Migration Plan

Nothing to migrate: no schema change, no config change, and the one new API field is additive, so an
older web app served by a newer daemon simply ignores it. The removed dropdown has no persisted
state of its own — the remembered workspace (`conductor.ws`) keeps its meaning and keeps being
written by `WorkspaceProvider`. Rollback is reverting the commit.
