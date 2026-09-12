## Context

See `proposal.md` for motivation. Confirmed against the current code:

- `ticket_documents` / `ticket_document_revisions` and `ticket_work_products`
  (`packages/db/src/migrations/0001_init.sql`) all carry a **`NOT NULL`** `ticket_id` (or
  `ticket_id`-derived) foreign key. No later migration relaxes it. `putDocument`/`getDocument`
  (`packages/core/src/tickets/service.ts:456-495`) always start from `get(id)` — a real ticket row.
  `TicketsService.artifacts()` (`packages/core/src/tickets/service.ts:1056-1068`) hard `JOIN`s
  `tickets`. None of this can hold a ticket-less row without either making the FK nullable and
  rebuilding the CHECK constraints (the SQLite-rebuild pattern migration `0027` used for
  `agents`/`decisions`) or adding new, parallel tables.
- `weave_ticket_artifact_put` (`packages/server/src/tools.ts:588-608`) is registered with
  `scope: 'all'` in `COMMON_TOOLS`, so a weaver can already call it today — but it still requires a
  ticket `id` it does not have, so in practice it's a worker-only tool despite the scope.
- `agents.kind` is `'weaver' | 'worker'` with a partial unique index guaranteeing exactly one weaver
  per workspace (`packages/db/src/migrations/0027_agent_kind_weaver.sql`). `ToolCtx.claims.agentKind`
  (`packages/server/src/tools.ts:33-38`) is how a handler already tells the two apart;
  `toolNamesFor(kind)` (`tools.ts:865-867`) is how a tool is hidden from the wrong kind entirely (not
  just rejected at call time) — the existing, established way to make a tool weaver-only.
- `packages/server/src/routes/artifacts.ts` already exists as a workspace-scoped route file
  (`GET /api/w/:ws/artifacts/kit.css`), mounted at `/api/w/:ws/artifacts` in `packages/server/src/app.ts`.
  It has no auth guard of its own beyond the surrounding workspace group.
- `ArtifactViewer.tsx`'s `ticketId` prop is used in exactly one place internally — its own
  `download()` re-fetch, which currently reconstructs `/tickets/${ticketId}/artifacts/${key}/raw`
  rather than reusing `artifact.url` (already the correct full path for either shape). The iframe
  `src`, "open", and "copy link" actions already derive from `artifact.url` alone.
- The document explorer (`KnowledgeExplorer.tsx`) already renders one flat, project-scoped
  `ArtifactsSection` at the bottom of the tree, fed by `useProjectArtifacts(project)` hitting
  `GET /knowledge/artifacts`. Chat messages already render as markdown (per `[[conductor-chat-composer]]`
  knowledge), so a plain URL a weaver writes into a chat reply is already clickable with no new
  rendering support needed.

## Goals / Non-Goals

**Goals:**
- A weaver can publish an HTML artifact with no ticket involved and get back a URL that, followed,
  renders the artifact inside the app — not a raw file, not a download prompt.
- That artifact is browsable as a set at workspace scope, matching captain's own words.
- The sandboxing property (opaque origin, `connect-src 'none'`, no cookie access, no agent read-back)
  holds identically to a ticket artifact — no second, weaker sandboxing story.
- `ArtifactViewer` is reused, not forked.

**Non-Goals:**
- Widening `ticket_documents`/`ticket_work_products` to accept a null ticket id. The FK is `NOT NULL`
  today for good reason (every other work-product type is genuinely ticket-shaped); rebuilding those
  constraints to admit one ticket-less case is a bigger, riskier migration than adding two new tables
  that need no constraint surgery at all.
- Letting a worker call the new tool. A worker always has a ticket and already has the right tool for
  it; the new tool exists only because a weaver has no ticket to attach anything to.
- Any change to what an artifact looks like, the kit, or ticket artifacts' existing behavior (per the
  ticket's own Out of Scope).

## Decisions

### 1. Where a weaver's artifact lives: a new workspace-scoped store, not chat-anchored, not knowledge

The ticket asks this to be argued rather than assumed. Taking the three options in turn:

- **Anchored to the chat message it answered** — cheaper to wire (no new listing surface), but fails
  captain's own ask ("my workspace artifacts folder... browsable"): an artifact would only be findable
  by scrolling chat history, with no collection view. Rejected.
- **In the knowledge tree** — the tree is already workspace-scoped and has a viewer, but knowledge is
  curated, hand-maintained prose (`[[knowledge-documents]]`); an artifact is a dated, one-off answer.
  Mixing them would put unstable, non-curated content next to the thing captain reads for durable
  facts, degrading both. `ticket-artifacts/explorer`'s own spec already states artifacts are
  deliberately excluded from the document/slug/graph model for exactly this reason, for the ticket
  case — the same reasoning applies here. Rejected.
- **A new workspace-scoped store** — matches captain's literal words, gives a real collection view,
  and mirrors a pattern that already exists twice over: `ticket_documents` is a per-ticket revisioned
  document store, and `routes/artifacts.ts` is already a workspace-scoped route file. **Chosen.**

### 2. New tables, not a nullable `ticket_id`

`weaver_artifacts` and `weaver_artifact_revisions`, mirroring `ticket_documents` /
`ticket_document_revisions`'s exact shape (a current-revision pointer row, an append-only revisions
table keyed by `(artifact_id, revision)`), but keyed by `(workspace_id, key)` instead of
`(ticket_id, key)`:

```sql
CREATE TABLE weaver_artifacts (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  key TEXT NOT NULL,
  current_revision INTEGER NOT NULL DEFAULT 0,
  title TEXT,
  kind TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (workspace_id, key)
);
CREATE TABLE weaver_artifact_revisions (
  id TEXT PRIMARY KEY,
  artifact_id TEXT NOT NULL REFERENCES weaver_artifacts(id),
  revision INTEGER NOT NULL,
  body TEXT NOT NULL,
  author_kind TEXT NOT NULL,
  author_id TEXT,
  run_id TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (artifact_id, revision)
);
CREATE INDEX weaver_artifacts_workspace_updated_idx ON weaver_artifacts (workspace_id, updated_at DESC);
```

No `url` column: unlike `ticket_work_products` (which stores a work product's URL because it also
represents PRs/branches/commits with genuinely different URL shapes), every row here is served by
exactly one route shape, so the URL is always computed from `workspace_id` + `key`, never stored —
one less place for it to drift.

Rejected: making `ticket_id` nullable on the existing tables and rebuilding their CHECK constraints
(the `0027`-style rebuild). That migration is the more invasive option for a benefit — reuse of the
exact same tables — that doesn't actually simplify anything downstream, since `TicketsService.artifacts()`
would still need a `LEFT JOIN` and every consumer of `ticketId` in the UI would still need to treat it
as optional. Two small, purpose-built tables with no nullable FK are less risky and no harder to query.

### 3. A dedicated service, not a widened `TicketsService`

A `WeaverArtifactsService` (or a couple of functions living alongside `packages/core/src/artifacts/kit.ts`,
which already holds the VS-268 artifact-kit constants) owns `put`/`get`/`list` against the two new
tables. `TicketsService` is not touched — it has no reason to know about workspace-scoped artifacts,
and `artifacts()`'s existing hard `JOIN tickets` stays exactly as it is (ticket artifacts only), matching
the proposal's "unmodified by design" list.

### 4. The new tool is weaver-only, named `weave_artifact_put`, and returns an app-page URL

`weave_artifact_put(key, html, { title?, kind? })` — no `id` parameter, since there is no ticket.
Registered with a **weaver-only scope** (a new `WEAVER_ONLY_TOOLS`-style entry, mirroring how
`WORKER_ONLY_TOOLS` already restricts tools the other way), so `toolNamesFor('worker')` never lists it
— a worker cannot call it even by guessing the name, consistent with Decision in the proposal that a
worker keeps using its ticket-scoped tool. Same HTML validation (`validateArtifactHtml`, unchanged) and
size cap as `weave_ticket_artifact_put`.

Its return value is **not** the raw-serve API path (`/api/w/:ws/artifacts/:key/raw`) the way
`weave_ticket_artifact_put` returns a bare API path today. For a ticket artifact that bare path is fine
because nothing is meant to hand it directly to a human — a human reaches a ticket artifact by opening
the ticket and clicking its Artifact tab. A weaver has no ticket page to route through, and the ticket's
own acceptance criteria are explicit: the returned URL must "open... rendered inside the web app — not
a download, not a raw file." So the tool returns an **in-app page URL**,
`/w/:ws/artifacts/:key` (see Decision 6), and that page is what fetches the raw route internally to
feed the iframe. This is the one piece of this design with no ticket-artifact precedent to mirror,
because a ticket artifact never needed a freestanding page.

### 5. Serving: same route shape, same headers, mounted in the existing workspace-scoped route file

`GET /api/w/:ws/artifacts/:key/raw[?revision=N]` and `GET /api/w/:ws/artifacts` (the list) both live in
`packages/server/src/routes/artifacts.ts`, alongside the existing `kit.css` route. The raw route copies
`ticket-artifacts/serving`'s exact contract verbatim: `requireOperator(c)` first (defense-in-depth,
mirroring the ticket route's own comment on why it's there even though `/api/w/:ws/artifacts/**` — like
`/tickets/**` — is already outside `RUN_TOKEN_PATHS`), the same three response headers with the
identical CSP string (extracted to one shared constant both routes import, so the two can never drift
apart), and a 404 on a missing key/revision. No agent-facing read tool is added for the body, for the
same "no agent can ever read one back" reason `ac_ticket_document_get` refuses an `artifact:`-prefixed
key — here there is simply no read tool over `weaver_artifacts` at all, which is a stronger guarantee
than a refusal.

### 6. Viewer: one new in-app page, `ArtifactViewer`'s `ticketId` made optional, one new explorer section

- `ArtifactViewer.tsx`'s `ticketId` becomes `ticketId?: string`. Its `download()` function is changed to
  fetch `artifact.url` directly instead of reconstructing a ticket-shaped path — this already matches
  what `src`/open/copy do today, so the change is a simplification, not a special case, and it makes the
  component correct for either shape with no internal branch on "do I have a ticket".
- A new route, `/w/:ws/artifacts/:key`, resolves the artifact's title/kind/revision list from the new
  `GET /api/w/:ws/artifacts` list (filtered client-side to the one key, or a dedicated single-artifact
  read if the list response is large enough to matter — a call made at implementation time) and renders
  `<ArtifactViewer ws={ws} artifact={{ key, title, url: rawUrl }} revisions={...} />` with no `ticketId`.
  This is the page both the tool's returned URL and a pasted chat link land on.
- The explorer gains a new, always-shown-when-non-empty section — "Weaver Artifacts" — populated from
  the same `GET /api/w/:ws/artifacts` list, positioned as its own peer entry (not merged into the
  existing project-scoped `ArtifactsSection`, which stays ticket-only per the proposal's Impact).
  Selecting a row navigates to the same `/w/:ws/artifacts/:key` page rather than building a second,
  inline viewing surface — one viewing surface, reached two ways (a direct link, or a click from the
  explorer), which is a smaller surface than the ticket case's inline `ArtifactPanel` needed to be
  (a ticket artifact never has to work as a cold, unauthenticated-until-loaded standalone link the way a
  pasted chat URL does).

### 7. Skill: one new section naming both tools, placed after "Format rules"

`skills/weave-ai-artifacts/SKILL.md` gains a new section (working title "Publishing and reaching the
human") between "Format rules" and "Diagram discipline", stating plainly: a worker with a ticket calls
`weave_ticket_artifact_put` and shares the returned URL; a weaver with no ticket calls
`weave_artifact_put` and shares that URL instead; neither ever attaches the raw HTML file. This closes
the exact gap the ticket names — the skill currently has no publishing section at all.

## Risks / Trade-offs

- **[Risk]** Two near-identical storage/serving code paths (ticket-scoped and workspace-scoped) could
  drift apart over time (e.g. one gets a CSP header fix the other doesn't). **Mitigation**: the CSP
  string and the HTML validation function are each a single shared constant/function imported by both
  routes/tools, not copy-pasted — the design's own Decision 5 states this explicitly as a task-level
  requirement, not left implicit.
- **[Risk]** A weaver could publish under a key that collides with something meaningful only by
  coincidence (there is no cross-workspace or cross-project namespacing beyond the key itself).
  **Mitigation**: keys are already scoped per-workspace (`UNIQUE (workspace_id, key)`), matching how a
  ticket artifact's key is already only unique per-ticket — no change in blast radius from the existing
  pattern.
- **[Risk]** Making `ArtifactViewer`'s `download()` fetch `artifact.url` instead of a ticket-shaped path
  could change behavior for the existing ticket viewer if `artifact.url` and the reconstructed path ever
  differed. **Mitigation**: confirmed in Context above that they are already the same string in the
  ticket case (`ac_ticket_artifact_put`'s returned `url` is exactly
  `/api/w/:ws/tickets/:id/artifacts/:key/raw`) — this is a no-op simplification for the existing caller,
  verified by the existing ticket-viewer tests continuing to pass unchanged.

## Migration Plan

One new additive migration (`0030_weaver_artifacts.sql`, two new tables, no existing table touched) —
applied automatically by the daemon's existing migration runner on next start. No backfill, since
there is no pre-existing data for a table that didn't exist. No rollback concern beyond the existing
migration-rollback story: dropping the migration removes the two tables and nothing else references
them.

Numbered `0030`, not the next-looking-free `0029`: `0028_incident_resolution.sql` is the highest
migration on `main`, but VS-295 (already approved and building) claims `0029_push_subscription_categories.sql`
first — a collision invisible from this branch alone, since a worker only ever sees `main` plus its own
branch, never another in-flight change's migration number. Flagged by the conductor during review.

## Open Questions
(none — the storage-location decision the ticket asked to be argued is resolved in Decision 1, and
every other choice here is either dictated by matching the existing ticket-artifact contract or
recorded as a decision with its rejected alternative)
