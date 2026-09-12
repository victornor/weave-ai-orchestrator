## Why

A weaver answering captain in chat has no ticket, and every published artifact today is structurally
a ticket document (`packages/core/src/api.ts:57-59`): storage, the raw-serve route, and the viewer all
require a ticket id. The only thing a weaver can do today is attach the raw HTML file to its message —
captain has to download it and load it locally. The artifacts skill also never names a publishing tool
or a destination at all, so this isn't just a missing storage tier, it's an undocumented capability.

## What Changes

- Add a workspace-scoped artifact store, independent of tickets: two new tables
  (`weaver_artifacts` / `weaver_artifact_revisions`) mirroring the shape of
  `ticket_documents`/`ticket_document_revisions` (append-only revisions, a current-revision pointer),
  keyed by `(workspace_id, key)` instead of a ticket id. `ticket_work_products`/`ticket_documents` stay
  untouched — this is a new, parallel home, not a widened one, because both have a `NOT NULL` ticket FK.
- Add `weave_artifact_put(key, html, { title?, kind? })` — the ticketless sibling of
  `weave_ticket_artifact_put`, scoped to the weaver (a worker already has a ticket and keeps using the
  existing tool). Same HTML validation and size cap, same republish-by-key revisioning. Returns a URL
  that opens the artifact **rendered inside the web app**, not the raw HTTP route directly.
- Add a workspace-scoped raw-serve route, `GET /api/w/:ws/artifacts/:key/raw[?revision=N]`, in the
  existing workspace-scoped `packages/server/src/routes/artifacts.ts`, with the exact same sandboxing
  CSP, `nosniff`, and human-web-session-only enforcement (`requireOperator`) as the ticket-scoped route
  it mirrors. No relaxed sandbox, no second sandboxing story.
- Add a small in-app page, `/w/:ws/artifacts/:key`, that renders the artifact through the shared
  `ArtifactViewer` (iframe over the raw route, revision selector, open/copy/download) with no ticket
  context. This is the page the tool's returned URL points at, and the page a chat link opens in one
  press — a raw-HTML URL alone would satisfy "a link" but not "rendered inside the web app, not a raw
  file", since opening `.../raw` directly has no app chrome and no revision picker.
  `packages/ui/src/components/ArtifactViewer.tsx` gains an optional `ticketId` (already only used
  internally by its own download re-fetch) so the same component serves both the ticket tab and this
  page — never a fork.
- Add a workspace-level "Weaver Artifacts" section to the document explorer, sourced from a new
  `GET /api/w/:ws/artifacts` list route, sitting alongside the project sections (matching captain's own
  words: "my workspace artifacts folder") rather than inside the existing per-project ticket-artifacts
  list, which stays ticket-scoped and unchanged. Selecting a row opens the same page above.
- Add an explicit "how this reaches the human" section to `skills/weave-ai-artifacts/SKILL.md`, naming
  both `weave_ticket_artifact_put` (worker, has a ticket) and `weave_artifact_put` (weaver, no ticket),
  and stating that the returned URL is what to share in chat, never the raw HTML file.

## Capabilities

### New Capabilities
- `weaver-artifacts/storage`: `weave_artifact_put`'s contract, the new tables, validation and
  revisioning, scoped to the weaver kind only.
- `weaver-artifacts/serving`: the workspace-scoped raw-serve route, its sandboxing headers, and
  human-web-session-only enforcement.
- `weaver-artifacts/viewer`: the standalone in-app page the returned URL opens, the workspace-level
  explorer listing, and reuse (not forking) of `ArtifactViewer`.

### Modified Capabilities
- `artifact-kit/skill`: adds a requirement that the skill states how an artifact reaches the human,
  for both the ticket-bound and ticketless tools — closing the instruction gap the ticket calls out.

## Impact

- New: `packages/db/src/migrations/0030_weaver_artifacts.sql`, a `WeaverArtifactsService` (or a home
  alongside `packages/core/src/artifacts/kit.ts`), a new `ToolDef` in `packages/server/src/tools.ts`, a
  new `ToolName` in `packages/shared/src/tools.ts` (scope: weaver only), two new routes in
  `packages/server/src/routes/artifacts.ts` (list + raw-serve), a new UI route/page, a new explorer
  section and its data hook, `packages/ui/src/api/types.ts` additions.
- Modified: `packages/ui/src/components/ArtifactViewer.tsx` (`ticketId` becomes optional),
  `skills/weave-ai-artifacts/SKILL.md`, `packages/server/src/routetable.ts`, `docs/API.md`.
- Unmodified, by design: `ticket_work_products`, `ticket_documents`, `weave_ticket_artifact_put`, the
  ticket page's Artifact tab, and the existing project-scoped Artifacts explorer entry — a weaver
  artifact is a new, parallel home, not a widened ticket one.
