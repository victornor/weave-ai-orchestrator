# V2 project links use the project's slug, not its display name

Tracker change for [VS-424](weave://tickets/VS-424). A `task` ticket, so this change carries tasks
only — `skip_specs: true`.

## Why

Captain, 2026-09-14: clicking a project in the V2 sidebar opens "No such project in this workspace."

In `packages/ui/src/v2/V2Shell.tsx` the expanded rail's project rows build both the link and the
active-row key from the project's **display name**:

```ts
const key = projectRowKey(p.name);
const href = `/v2/w/${encodeURIComponent(w.id)}/p/${encodeURIComponent(p.name)}`;
```

The route resolves the `:project` param with `resolveProject`
(`packages/ui/src/lib/projectOverview.ts`), which matches `p.id` or `p.slug` only — never `p.name`.
Every project in this workspace has a name that differs from its slug (`WeaveAI` /
`agent-conductor`, `Fernwood` / `fernwood`, `Weave Services plugin` / `weave-services-plugin`), so
`/p/WeaveAI` never resolves and the rail highlights nothing. The V2 shell test passed only because
its fixtures set `name === slug` (`web` / `web`, `api` / `api`).

## What changes

- **The rail row uses the slug.** Both the `href` and `projectRowKey(...)` take `p.slug`, so the
  route param and the active-row key are the same value and the row highlights on its own page.
  `p.slug` is the convention: V1's sidebar and More sheet (`app/WorkspaceNav.tsx`,
  `app/MoreSheet.tsx`), the global Map (`routes/GlobalMap.tsx`) and `lib/map/model.ts` all link with
  the slug, and `router.tsx` documents the project as slug-addressed.
- **The page still accepts an id or a slug.** `resolveProject` is unchanged, so bookmarked slug
  URLs and any id-addressed link keep working.
- **Tests use a name that differs from its slug.** `v2shell.test.tsx`'s fixtures become
  `WeaveAI` / `agent-conductor` and friends, asserting the `/p/agent-conductor` href and that the
  row highlights when the route is the slug.
- **Audit of the other V2 project references.** The V2 Work cards, ticket header and Live cards
  render the project as a coloured label, not a link; the V2 Map opens the Work board filtered by
  the project **id** (`filterTickets` takes an id). None of them is a link to the project page, so
  the rail row was the only place to fix.

## Out of scope

- Adding project rows to the collapsed rail or the phone More sheet. Neither surface renders
  projects today — both are destination lists of marks (`docs/design/v2/HANDOFF.md` §4), and the
  mockup agrees — so there is no wrong link there to fix. If captain wants projects reachable from
  those surfaces, that is a separate UI change.
- Changing `resolveProject` to also accept a display name.
