## Context

`packages/ui/src/routes/Settings.tsx` is a single 890-line route: a `SECTIONS` tuple of eight
`{key, label}` pairs, one `useState<string>('workspace')`, a `Tabs` strip in the `PageHeader`, and
eight sibling section components rendered by an equality chain. Nothing about the page knows that its
sections have different scopes; the scope map is in the proposal.

Three constraints shape the approach.

The app shell requires a workspace. `AppShell` renders inside `WorkspaceProvider`, which is mounted
by the `/w/$ws` route and owns the SSE stream (`packages/ui/src/api/context.tsx`); every rail and tab
target in `packages/ui/src/app/nav.ts` is `/w/$ws/...`. There is no shell for a route outside a
workspace, so a daemon-level *route* would need one built.

The cache is already correct. `QueryClient` is created in `packages/ui/src/main.tsx` above
`RouterProvider`, so it outlives a workspace change, and the daemon-level keys in
`packages/ui/src/api/keys.ts` — `['daemon','update']`, `['daemon','upgrade']`, `['sessions']`,
`['me']`, `['workspaces']`, `['runtimes']` — carry no workspace segment, while every workspace key
starts `['w', ws]`. Daemon state is one entry shared by every workspace today.

The route already passes search params through. `settingsRoute` is declared with `searchPassthrough`
in `packages/ui/src/router.tsx`, so `?area=…&section=…` needs no route-tree change, and `BoardRoute`
already shows the idiom: `useSearch({ strict: false })` to read, `go(path, { params, search, replace:
true })` to write.

## Goals / Non-Goals

**Goals:**

- One structural change inside one route file, with the section components moved rather than rewritten.
- A section's area derivable from its key, so a link needs only the key.
- Tests that pin the two properties that are easy to regress silently: a section stays in its area, and daemon state is not cached per workspace.

**Non-Goals:**

- A second route, or any change to the route tree, the rail, the phone tabs or the app shell.
- Any change to a section's contents beyond moving the theme field, and no change to any API, server route or storage location.
- Fixing the push-subscribe path mismatch recorded at the end of the proposal.

## Decisions

**Two areas inside the one route, not two routes.** The acceptance criteria allow either. Two routes
would mean a daemon-level path outside `/w/$ws` and therefore a second shell, or a
`/w/:ws/settings/daemon` path that still spells a workspace in the URL of a global setting — the
confusion the ticket is about. Areas inside the existing route keep the change to one file, keep the
More tab and the rail entry working untouched, and still put the area in the URL. Rejected: a
top-level `/settings` route (needs a shell, and the workspace switcher and event stream would have to
be reasoned about again); a modal (not deep-linkable).

**The area switcher is a `Segmented` control in the header's `actions` slot, above the `Tabs`
strip.** `PageHeader` already takes `actions` and `tabs`, and `Segmented` is the existing
switcher shape (`packages/ui/src/components/Tabs.tsx`). Two controls of different shapes read as two
levels; two tab strips would read as one confusing eleven-tab row. It wraps on a phone because the
header is `flex-wrap`, so nothing is pushed off screen. Rejected: grouped headings inside one strip
(the strip already scrolls horizontally on a phone, so a heading scrolls out of view and the label
stops doing its job).

**One flat `SECTIONS` table with an `area` field is the single source of truth**, replacing the
current tuple: `{ key, label, area }`. The tab strip filters by the selected area, the area of a
`?section=` link is a lookup in the same table, and adding a section later cannot put it in two
areas or in none. Rejected: two tables (nothing stops a key appearing in both).

**`section` is the primary URL parameter; `area` is written but only consulted as a fallback.**
Resolution order: if `section` names a known key, that section is shown and its area comes from the
table — this is what lets the sidebar update entry link by key alone. Otherwise the area comes from
`area` when it names one, and the first section of that area is shown. Otherwise the workspace area
and its first section. So the page never renders an empty body, and no link can address a section
under the wrong area. Both parameters are written on every change, with `replace: true`, so clicking
through six sections leaves one history entry, not six — matching `chooseFinished` in
`BoardRoute`.

**The theme picker moves into the new `device` section; the notification toggles come with it.**
Theme is `localStorage` `conductor.theme` (`packages/ui/src/lib/theme.ts`) and today sits between the
workspace's name and its ticket prefix, which is the clearest instance of the mislabelling the ticket
describes. The notification toggles are `localStorage` `conductor.notifs` and were already their own
section. Grouping them is the smallest move that leaves nothing per-device filed as workspace state.
The section is labelled "This device" with a caption saying the settings are stored in this browser
only, and it is filed under the daemon area because — like the daemon's own settings and unlike the
workspace's — it reads the same whatever workspace you came from. The page still has exactly two
areas; the section label carries the device distinction, which is what the criterion asks for.
Rejected: a third "This device" area (the criteria say two); leaving the theme under Workspace with a
caption (the caption would contradict the area it sits in).

**Section keys are preserved except `notifications` → `device`.** The seven other keys are the URL
contract other tickets will link against, and `updates` in particular is the one the sidebar entry
needs. `notifications` is renamed because the section now holds the theme as well and "notifications"
would no longer describe it; nothing can be linking to it, because before this change no section was
addressable at all.

**Daemon-scope caching gets a test, not a code change.** The keys and the client placement are
already right; what is missing is anything that fails when someone adds `ws` to a daemon key or moves
the `QueryClient` under `WorkspaceProvider`. A unit test over `qk` asserting that the daemon-level
keys contain no workspace segment while the workspace-level ones start `['w', ws]` catches both
regressions at the point they are introduced, and costs nothing to run.

## Risks / Trade-offs

- **A section becomes harder to find because it moved to the other area.** → The two areas are on
  screen at once in the header, both labelled, and the first thing an operator sees is the area they
  are already in. Nothing is behind a menu.
- **The header grows a second row on a narrow phone.** → `PageHeader`'s top row is already
  `flex-wrap` and the tab strip already scrolls horizontally; the switcher is two short chips. The
  phone reachability requirement in the spec is covered by its own scenario and its own test.
- **`?section=` and `?area=` disagree in a hand-written link.** → `section` wins and its own area is
  selected, so the page is never internally inconsistent; specified as a scenario.
- **Every existing test reaches its section by clicking a tab label, so tests that never mentioned
  areas break.** → Intended: both `settings.test.tsx` and `updates.test.tsx` are updated in the same
  change, and `updates.test.tsx`'s `openUpdates()` helper is the single place its switch is made.
- **VS-50 and VS-46 touch this same file.** → The area assignment is a table entry per section, so a
  section added or changed by either ticket is one row plus its existing component; the ticket
  already directs rebasing on them at merge time.

## Migration Plan

None. No stored state, no API and no route path changes, so nothing to migrate and nothing to roll
back beyond reverting the commit. Existing bookmarks of `/w/:ws/settings` keep working and land on
the workspace area's first section, exactly as they do today.
