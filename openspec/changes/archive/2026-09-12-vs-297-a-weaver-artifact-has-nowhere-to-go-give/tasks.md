## 1. Storage

- [x] 1.1 Add `packages/db/src/migrations/0030_weaver_artifacts.sql` (not `0029`: VS-295, already
  approved and building, claims `0029_push_subscription_categories.sql` first — invisible from disk on
  this branch alone, flagged during plan review) creating `weaver_artifacts`
  (`id`, `workspace_id NOT NULL REFERENCES workspaces(id)`, `key`, `current_revision`, `title`, `kind`,
  `created_at`, `updated_at`, `UNIQUE (workspace_id, key)`) and `weaver_artifact_revisions` (`id`,
  `artifact_id NOT NULL REFERENCES weaver_artifacts(id)`, `revision`, `body`, `author_kind`,
  `author_id`, `run_id`, `created_at`, `UNIQUE (artifact_id, revision)`), plus the
  `(workspace_id, updated_at DESC)` index. Verify the migration applies cleanly against a fresh
  in-memory/test DB and `pnpm --filter @weave-ai/db test` (or the equivalent migration test) passes.
  Done: applies via the harness's real `openDb` in `service.test.ts`; no dedicated migration-runner
  test package exists to add to.
- [x] 1.2 Add a `WeaverArtifactsService` (or functions alongside `packages/core/src/artifacts/kit.ts`)
  with `put(actor, workspaceId, key, html, { title?, kind? })` (append-only revisioning, upsert the
  `weaver_artifacts` row's `current_revision`/`title`/`kind`/`updated_at`), `getRevision(workspaceId,
  key, revision?)`, and `list(workspaceId)` (most-recently-updated first). Reuse the existing
  `validateArtifactHtml` validation (empty / non-HTML / oversized) unchanged rather than duplicating it.
  Verify unit tests: first publish returns revision 1; republishing under the same key increments the
  revision, leaves exactly one `weaver_artifacts` row, and the prior revision's body remains fetchable
  by explicit revision number; each of the three validation rejections is covered. Done:
  `packages/core/src/artifacts/service.ts` + `service.test.ts`. `validateArtifactHtml`'s three
  rejections are covered by the existing `weave_ticket_artifact_put` tests and the tool-layer test
  added in 2.2 (it is one shared function, not duplicated — nothing new to unit-test at the service
  layer, which never sees an unvalidated body).
- [x] 1.3 Verify a unit test confirms a ticket artifact and a workspace-scoped artifact can share the
  same key value in the same workspace with no collision (per `weaver-artifacts/storage`'s
  independent-key-space requirement). Done: `service.test.ts` "the same key can exist on a ticket and
  in the workspace store with no collision".

## 2. Tool

- [x] 2.1 Add a new `ToolName` (e.g. `weave_artifact_put`) in `packages/shared/src/tools.ts`, in a
  weaver-only tool set (mirroring the existing `WORKER_ONLY_TOOLS` pattern in the opposite direction),
  so `toolNamesFor('worker')` never includes it. Verify `pnpm typecheck` passes and a test asserts the
  new tool name is absent from the worker tool list and present in the weaver tool list. Done: added
  to the existing `WEAVER_TOOLS` array (the real gate `toolNamesFor` reads — `ToolDef.scope` turned out
  to be descriptive only, unused by any access check); covered by
  `integration.test.ts`'s "is unreachable by a worker" test, which proves the gate end to end rather
  than re-asserting array membership `tools.test.ts`-style.
- [x] 2.2 Add the `ToolDef` in `packages/server/src/tools.ts`: input `{ key: z.string().regex(...),
  html: z.string(), title: z.string().max(200).optional(), kind: z.string().max(40).optional() }` (no
  `id`), calling the 1.2 service and returning `{ url, revision }` where `url` is the in-app page path
  from task 4.2 (`/w/{ws}/artifacts/{key}`), not the raw-serve path. The tool's `description` states
  there is no matching read tool and that revising an artifact means calling this again under the same
  key. Verify a test calls the tool as a weaver and asserts the returned `url`/`revision` shape and that
  the artifact is listable afterward (task 1.2's `list`); verify a second test calls it as a worker (or
  confirms the tool is unreachable for a worker's session) and asserts rejection, consistent with
  `weaver-artifacts/storage`'s weaver-only requirement. Done:
  `packages/server/test/integration.test.ts`'s new "weaver artifacts (VS-297)" describe block.

## 3. Serving

- [x] 3.1 Extract the ticket-artifact raw route's CSP string (`packages/server/src/routes/tickets.ts`)
  into one shared constant both the ticket route and the new workspace route import, so the two can
  never drift apart (design.md Decision 5 / Risk 1). Verify the existing ticket-artifact serving tests
  still pass unchanged after the extraction. Done: `packages/server/src/artifact-csp.ts`; the full
  `ticket artifacts (VS-269)` describe block in `integration.test.ts` still passes unchanged.
- [x] 3.2 Add `GET /api/w/:ws/artifacts/:key/raw` (optional `?revision=N`) to
  `packages/server/src/routes/artifacts.ts`: `requireOperator(c)` first, then read via 1.2's
  `getRevision`, 404 JSON on a missing artifact/revision, or `c.text(body, 200, { same three headers as
  3.1 })`. Verify a test fetches a published workspace-scoped artifact's raw URL over HTTP and asserts
  the response body matches the stored bytes exactly, every header is present with the exact shared CSP
  string, and a request naming an earlier revision returns that revision's exact bytes. Done.
- [x] 3.3 Verify by test that the new raw route rejects a request authenticated only with a run-token
  bearer credential (the agent path), the same way the ticket route does. Done: 403, same as 2.1's note.
- [x] 3.4 Add `GET /api/w/:ws/artifacts` to the same file, returning the 1.2 `list` result (key, title,
  kind, updated-at — no body) as JSON. Verify a test publishes two workspace-scoped artifacts and
  asserts the list returns both, most-recently-updated first, with no `body` field present. Done.
- [x] 3.5 Register both new routes in `packages/server/src/routetable.ts`'s `ROUTES` array (`auth:
  'session'`) and document both in `docs/API.md` in the same style as the existing ticket artifact
  routes. Done.

## 4. Viewer

- [x] 4.1 Make `ArtifactViewer.tsx`'s `ticketId` prop optional and change its `download()` function to
  fetch `artifact.url` directly instead of reconstructing a ticket-shaped path. Verify the existing
  ticket-page Artifact tab tests still pass unchanged (confirming this is a no-op simplification for
  the existing caller, per design.md's stated risk mitigation). Done: `download()` strips the known
  `/api/w/:ws` prefix back off `artifact.url` and calls `api.ws` with the remainder — generalizes to
  either artifact shape without reconstructing a ticket-specific path; all 33 `ticketpage.test.tsx`
  tests (including the download one) pass unchanged.
- [x] 4.2 Add a new web app route, `/w/:ws/artifacts/:key`, that resolves the workspace-scoped
  artifact's title/kind/revisions from 3.4's list (or a dedicated single-artifact read, if needed) and
  renders `<ArtifactViewer>` with no `ticketId`, using 3.2's raw URL. Verify a component test renders
  the page for a published workspace-scoped artifact and asserts the iframe, revision selector (when
  more than one revision exists), and open/copy/download actions are present, matching the ticket
  viewer's existing behavior. Done: `packages/ui/src/routes/WeaverArtifactPage.tsx` +
  `weaverartifactpage.test.tsx` (3 tests).
- [x] 4.3 Add a `useWorkspaceArtifacts()` hook (calling 3.4's list route) and a new, always-shown-when-
  non-empty "Weaver Artifacts" section in `KnowledgeExplorer.tsx`, positioned as its own peer entry
  alongside the project sections — never merged into the existing project-scoped `ArtifactsSection`.
  Selecting a row navigates to 4.2's page. Verify a component test: the section is absent for a
  workspace with no workspace-scoped artifacts, appears once one is published, and lists a second one
  published under a different key with correct recency ordering. Done: recency ordering is asserted at
  the service layer (task 1.2's `service.test.ts`) — the explorer trusts the list's own order and does
  not re-sort, exactly like the existing ticket-scoped `ArtifactsSection`; the component test instead
  covers the two-entries-are-genuinely-separate and click-navigates cases.
- [x] 4.4 Verify by test that a newly published workspace-scoped artifact (or a new revision) appears
  in the explorer's new section without a page reload, reusing the existing SSE/query-invalidation
  plumbing pattern (a new event or reconciliation on the existing artifact-list query key, whichever
  the current event wiring supports most directly — confirm against `events.ts`'s `TRACKED`/
  `invalidateFor` during implementation rather than assuming a new event type is needed). Done, with a
  deviation flagged rather than absorbed silently: no existing event fits (every candidate is
  ticket-scoped; this store has no ticket at all), so a new tracked event,
  `weaver_artifact.published`, was added to `packages/shared/src/events.ts` and wired into
  `packages/ui/src/api/events.ts`'s `TRACKED` array and `invalidateFor`, invalidating
  `qk.weaverArtifactsRoot`. Verified two ways: the service-layer test asserting the event is emitted
  (`service.test.ts`), and a direct `invalidateFor` unit test in `events.test.tsx` (mirroring the
  existing VS-270 "document explorer's Artifacts entry" block) asserting the new event invalidates
  `qk.weaverArtifactsRoot` and never the ticket-scoped `qk.artifactsRoot`.

## 5. Skill

- [x] 5.1 Add a new section to `skills/weave-ai-artifacts/SKILL.md`, between "Format rules" and
  "Diagram discipline", naming `weave_ticket_artifact_put` (worker, has a ticket) and
  `weave_artifact_put` (weaver, no ticket) explicitly, stating that each call's returned URL — never an
  attached HTML file — is what belongs in a comment or chat reply. Verify
  `packages/shared/src/tools.test.ts` (which fails on any stray or unregistered tool-name token in
  agent-facing prose) passes against the edited file. Done: "Publishing and reaching the human"
  section added; `tools.test.ts` green.

## 6. Checks

- [x] 6.1 `pnpm lint && pnpm typecheck && pnpm test` all green. Paste both `pnpm test` suite blocks
  verbatim (core/server suite and UI suite) with their real totals in the delivery report — never just
  one, never a retyped combined figure. Done: lint clean, typecheck clean. After rebasing onto main
  (which had since merged VS-295/VS-298/VS-299/VS-302), re-ran the full suite: core/server 179 files
  passed | 1 skipped (180) / 2662 tests passed | 1 skipped (2663), UI 96 files passed (96) / 1572 tests
  passed (1572) — every test in both suites green. The combined script still exited 1 because of the
  pre-existing, already-documented `app.test.ts` unhandled EPIPE flake (project KB: VS-263,
  `routes/daemon.ts:359`'s `child.stdin.end(audio)` racing the child's exit) — confirmed unrelated by
  re-running that file alone, clean (86/86), same as the KB entry's own precedent.
- [x] 6.2 Publish one workspace-scoped artifact through the real tool path (a test daemon, not the live
  one — never the real coding CLI against live credentials), open the returned URL in a browser, and
  attach a screenshot of it rendered inside the web app to the ticket, per the ticket's "how this gets
  reviewed" instruction. Done: a throwaway Node script (deleted, never committed) booted the real
  daemon app (`createApp`) over a real loopback HTTP listener against a fresh harness workspace and
  built `packages/ui/dist`, called `runTool('weave_artifact_put', ...)` — the actual tool handler, no
  ticket, no coding CLI involved — then headless Chromium opened the returned
  `/w/:ws/artifacts/:key` URL and screenshotted it: the app shell, the artifact's title/kind in the
  header, and the sandboxed iframe's content rendering the published HTML. Screenshot delivered as an
  uncommitted file in this worktree, not the repo, per house convention: absolute path
  `/home/user/agent-conductor/workspace/workers/01M2B0MF6JJJAEP8EHJE0B9M6Z/work/vs297-verification-screenshot.png`.
