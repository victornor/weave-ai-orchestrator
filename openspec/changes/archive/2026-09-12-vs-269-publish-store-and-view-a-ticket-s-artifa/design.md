## Context

See `proposal.md` for motivation. This picks up where VS-268 (the kit, the skill, `ac_artifact_kit`)
left off, now that storage is settled as ticket documents. Relevant existing shape, confirmed by
reading the current code:

- `putDocument(actor, id, key, body, opts?)` (`packages/core/src/tickets/service.ts:446-482`) already
  reserves one key: `key === 'plan'` throws `forbidden` unless `opts.system`. `getDocument`/
  `getDocumentById` apply no key filtering at all. `documents(id)` (the list) already returns
  metadata only — `{ key, revision, updatedAt }`, never `body` — for every key uniformly.
- `ticket_work_products.type` already CHECK-allows `'artifact'`; `title`, `url`, `metadata_json`
  columns already exist. `addWorkProduct` always inserts — it has no upsert semantics.
- `/api/w/:ws/tickets/**` is session-scoped today by omission: `RUN_TOKEN_PATHS`
  (`packages/server/src/auth.ts:22`) only matches `/mcp/**` and `/api/w/:ws/agent/**`, so a bearer run
  token (an agent) is rejected by `authMiddleware` before it ever reaches a ticket route. Agents only
  ever reach ticket documents through the MCP/agent-REST tool layer
  (`packages/server/src/tools.ts`), never through the raw HTTP ticket routes. This is what makes the
  read-back closure a tool-layer concern, not an HTTP-layer one.
- `packages/core/src/artifacts/kit.ts` (VS-268) exports `ARTIFACT_KIT_CSS`, `ARTIFACT_KIT_MARKERS`
  (comment markers a document embeds to prove the kit is inlined — built for the drift test, reusable
  here to detect "does this document already carry the kit"), `artifactKitTokens()`,
  `ARTIFACT_KIT_COMPONENTS`, `readArtifactPlaybooks()`. There is no existing helper to inline the CSS
  into an arbitrary HTML string, and no route yet serves the kit CSS to a browser — `packages/ui` has
  no dependency on `@agent-conductor/core` (correctly: `core` is server-only, uses `node:fs`) and
  `packages/shared` should not gain a second, drift-prone copy of the CSS text.
- No DB migration is required anywhere in this design: confirmed against
  `packages/db/src/migrations` (latest `0026_agent_handovers.sql`).

## Goals / Non-Goals

**Goals**
- One tool call publishes an artifact and it is immediately visible on the ticket's Work surface and
  Artifact tab, with no second step.
- No agent can retrieve an artifact's HTML body through any tool, ever — verified, not just documented.
- The served artifact is inert with respect to the app: no cookie, no API call, no network egress,
  regardless of what the HTML tries to do.
- A downloaded artifact is provably standalone: it renders identically with the network disabled.

**Non-Goals** (see proposal.md's Impact and the ticket's own Out of scope list)
- A dedicated `ticket_artifacts` table, artifact catalog, revision diff, Mermaid, auto-drafted
  artifacts, the document-explorer surface, any annotation/feedback mechanism.
- Enforcing the skill's authoring rules (no external refs, no `<script src>`) as a hard server-side
  scanner. The CSP already makes violations inert at view time; the skill is what shapes authoring
  behavior. The server validates shape (is this HTML, is it under the size cap) and defers content
  discipline to the skill and the sandbox.

## Decisions

### 1. Reserve the `artifact:` prefix in `putDocument`, mirroring the existing `plan` guard

Extend the existing check at `service.ts:447-449` with a second clause: a key starting with
`artifact:` is rejected unless `opts.system` (or a new `opts.artifact` flag — naming TBD at
implementation, functionally identical to how `plan` already uses `opts.system`). `ac_ticket_artifact_put`'s
handler calls `putDocument(actor, id, \`artifact:${key}\`, html, { system: true })` internally; the
ordinary `ac_ticket_document_put` tool and its HTTP route continue to call `putDocument` without that
flag, so a direct attempt to write `artifact:foo` through the general path is rejected with a message
naming `ac_ticket_artifact_put` as the correct tool. This keeps exactly one path that can create an
artifact document, which is what makes the work-product upsert and the size/shape validation
unconditionally true for every artifact document that exists — nothing can create one out-of-band.

Rejected: a separate table/namespace instead of a key prefix. The ticket explicitly asks for reuse of
`putDocument`'s revisioning; a prefix costs nothing and the guard is a two-line addition to an
existing, well-understood check.

### 2. Read-back closure lives in the tool handler, not in `getDocument`

`getDocument`/`getDocumentById` stay unfiltered — the new raw-serve HTTP route needs to read the body
by key, and filtering at the service layer would have to special-case its own caller. Instead,
`ac_ticket_document_get`'s handler (`packages/server/src/tools.ts:325-337`) checks the requested key
before calling `getDocument`: if it starts with `artifact:`, it throws a `forbidden` `OcError` whose
message states the reason and the alternative (republish via `ac_ticket_artifact_put` instead of
reading back), rather than returning nothing (a bare 404 reads as "have I got the key wrong?", which
invites a confused agent to keep guessing) or a metadata stub (implies partial access to something
that is fully off-limits). This is the "refusal that explains itself" option the ticket asked me to
argue for. The same handler's `not_found` path, which lists `availableKeys` as a hint
(`tools.ts:332-333`, backed by `documents(id)`), filters `artifact:`-prefixed keys out of that list —
otherwise a wrong-key guess would leak that an artifact exists (and its key) as a side effect, which
undercuts "no agent can ever read one back" even though it's metadata, not body.

`ac_ticket_document_put` gets the same key-prefix check as a fast, explicit rejection (see Decision 1)
rather than silently succeeding and producing an untracked, unvalidated artifact document with no
work product — that would be a document the viewer can never find and the read-back guard would still
correctly block, but it would be dead, confusing state.

The document list tool path needs no change: `documents(id)` already returns metadata only for every
key (Context above), which already satisfies "return metadata without the body" for artifacts as a
side effect of an existing, uniform behavior — there is no separate agent-facing "list documents"
tool today (only the `not_found` hint array, handled above).

I chose *forbidden-with-reason* over *nothing* or *metadata-stub* because the ticket's own framing
("kindest to a confused worker") matches what actually happens operationally: a worker that authored
an artifact earlier in the same run and later tries to re-read it (e.g. after a context compaction)
needs to learn *why* in one round trip, not spend a turn guessing between "wrong key" and "no
access". The skill (VS-268) and this tool's own description both state the republish-don't-read shape
up front, so the error is confirmation of a documented rule, not a surprise.

### 3. Work product upsert keyed by `(ticket_id, type='artifact', external_id=key)`

`addWorkProduct` only inserts. Rather than add upsert semantics to that generic function (used by
`pull_request`/`branch`/`commit`/etc., which have their own identity rules), add one new
tickets-service function, `putArtifactWorkProduct(actor, ticketId, key, { url, title, kind, revision })`,
that looks up an existing row by `ticket_id + type='artifact' + external_id=key` and updates it in
place (bumping `url`/`title`/`updated_at`, storing `kind` inside `metadata_json` since there is no
dedicated column and none is being added — see Context above) if found, or calls `addWorkProduct` if not.
Using the existing `external_id` column as the stable artifact key (rather than a `json_extract` query
against `metadata_json`) reuses a plain indexed-by-nothing-but-still-simple TEXT equality check and
matches how other work-product types already use `external_id` as their natural key (PR number,
branch name). One `ticket_work_products` row per artifact key, regardless of how many document
revisions it has accumulated — the revision history lives in `ticket_document_revisions`, which the
work product's `url` (revision-less, always "current") and the viewer's explicit revision selector
both already handle correctly by construction.

Rejected: a `kind` migration (a real column). Nothing in this ticket needs `kind` to be queryable or
indexed — it is display metadata for the viewer's list. Adding it to `metadata_json` costs nothing and
avoids migration `0027` for a field with no query requirement (revisit if Phase 2's dedicated
`ticket_artifacts` table happens; that phase was explicitly deferred).

### 4. Raw-serve route: read-only, verbatim, CSP as specified, `requireOperator` as defense-in-depth

`GET /api/w/:ws/tickets/:id/artifacts/:key/raw[?revision=N]` reads `getDocument(id, \`artifact:${key}\`, revision)`
and returns the body via Hono's `c.text(body, 200, headers)` (the same primitive `GET /runs/:id/log`
already uses), with the three headers exactly as captain's specification states them (verbatim CSP
string, `text/html; charset=utf-8`, `x-content-type-options: nosniff`). A missing document (bad key,
bad revision, or a non-artifact key) returns a 404 JSON error, matching the shape of other ticket
route errors. Auth: the path is under `/tickets/**`, so it is excluded from `RUN_TOKEN_PATHS` already
(Context above) — an agent's run token cannot reach it. As explicit defense-in-depth (this route
serves attacker-shaped content by design, unlike other ticket routes), the handler additionally calls
`requireOperator(c)` before doing anything else, so even a future accidental change to
`RUN_TOKEN_PATHS` would not silently open this specific route to a run token.

### 5. Kit CSS reaches the browser via a tiny new asset route, not a second copy

`GET /api/w/:ws/artifacts/kit.css` (session-authenticated, same auth posture as the ticket routes)
returns `ARTIFACT_KIT_CSS` verbatim as `text/css`. This is the "optionally serve the canonical kit at a
stable asset path" captain's specification names. The web app's download handler fetches this once,
checks the artifact HTML for `ARTIFACT_KIT_MARKERS` (already exported by `kit.ts` for exactly this
"does this doc already embed the kit" question), and if absent, injects a `<style>` block containing
the fetched CSS immediately before `</head>` (or wraps the whole document in a synthesized `<head>` in
the pathological case of a fragment with no `<head>` tag) before triggering the browser download. If
the markers are already present (an artifact authored per the skill's own discipline, which mandates
inlining the kit), the download is byte-identical to the stored document — no double-inlining.
Rejected: duplicating `ARTIFACT_KIT_CSS`'s text into `packages/shared` or `packages/ui` for the browser
to import directly — this recreates the exact single-source-of-truth problem VS-268's drift test
exists to prevent, for zero benefit over one small authenticated fetch.

### 6. Viewer: one tab, sandboxed iframe, work-products as the source list

The Artifact tab appears in `TABS` (`TicketPage.tsx:46-53`) only when `useTicketWorkProducts(ticketId)`
contains at least one `type === 'artifact'` row — consistent with "shown when the ticket has
artifacts". The list panel renders those rows (`title ?? externalId`, `metadataJson.kind`,
`updatedAt`); selecting one sets the iframe `src` to that artifact's raw-serve URL (a same-origin
relative path, `?revision=N` when a non-current revision is picked via
`useTicketDocumentRevisions(id, \`artifact:${key}\`)` — already reusable as-is, since it returns
revision metadata only). The `<iframe>` carries its own matching `sandbox="allow-scripts allow-forms
allow-popups allow-downloads"` attribute in addition to the server's CSP `sandbox` directive —
belt-and-suspenders: the CSP is authoritative and applies regardless of how the document is loaded,
but an explicit iframe attribute costs nothing and guards against any future embedding path that might
not preserve response headers faithfully (e.g., a caching proxy). No new SSE event: `ticket.document`
and `ticket.work_product` are already in `events.ts`'s `TRACKED` array with `invalidateFor` handling
that already invalidates the right query keys (`events.ts:301-313`) — an artifact publish is exactly
one of each event, so the existing plumbing refreshes the tab with no changes there.

`packages/ui/src/api/types.ts`'s `WorkProduct` interface is fixed as part of this change (`ref`/`meta`
removed, `title: string | null` and `metadataJson: Record<string, unknown>` added) to match the actual
wire shape — the Artifact tab cannot read `title`/`kind` through the current, already-wrong type, and
this was a latent bug independent of artifacts.

## Risks / Trade-offs

- **[Risk]** A worker could still write a well-formed `artifact:`-prefixed document through some path
  this design didn't anticipate (e.g. a future generic "admin" document tool). **Mitigation**: the
  guard lives in `putDocument` itself (Decision 1), the one function every document write funnels
  through, not in each individual tool handler — any new caller inherits the restriction for free.
- **[Risk]** The size cap could reject a legitimate large artifact (many embedded images as data URIs).
  **Mitigation**: cap set generously (design.md's task list fixes the exact number; see tasks.md) at a
  level well above any realistic hand-authored document, with a clear validation error naming the limit
  so an agent can react (split into two artifacts, use fewer/lighter data URIs) rather than fail
  silently.
- **[Risk]** `requireOperator` on the raw-serve route could reject a legitimate loopback-trusted local
  CLI request if that principal kind doesn't satisfy `requireOperator`'s check. **Mitigation**:
  verified against `auth.ts`'s actual `requireOperator` implementation during apply (task item), not
  assumed; if loopback-trusted requests need this route (e.g. the `conductor` CLI rendering an
  artifact locally), the check is adjusted rather than the route left broken for that caller.

## Open Questions
(none — the ticket's own "decide and state" ask is resolved in Decision 2, and the storage question
that blocked VS-268 was resolved by captain before this ticket was filed)
