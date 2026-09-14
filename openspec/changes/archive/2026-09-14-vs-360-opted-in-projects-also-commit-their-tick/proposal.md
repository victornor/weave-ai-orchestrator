## Why

VS-358 let an opted-in project commit its knowledge into its own repo, but deferred artifacts (VS-355 Q5): today every ticket artifact is a database row only, rendered through a sandboxed viewer, with no git history and no way for a human to review or edit it alongside the code it documents. Captain asked for the artifacts half of the same design now that VS-358 has landed.

## What Changes

- Reuse VS-358's `knowledgeRepo.enabled` project flag — no new toggle. For an opted-in project, `weave_ticket_artifact_put` also writes the published HTML (and a small metadata file for `title`/`kind`) into the publishing worker's worktree at `.weave/artifacts/<TICKET-IDENTIFIER>/<key>.html` / `<key>.meta.json`, committed with the ticket's other changes; the `ticket_documents`/`artifact:<key>` row and its revision are written exactly as today.
- Unlike knowledge's shared per-project hub files, an artifact's repo path is namespaced by the publishing ticket's own identifier, so no two tickets ever contend for the same file — there is no cross-ticket merge problem to solve here.
- A path-boundary check is the single place a path may cross into `.weave/artifacts/**`; a weaver's ticket-less artifact (`weave_artifact_put`, workspace-scoped) never has a worktree to mirror into and so structurally never reaches a repo — proven by tests, not left to convention.
- Before a mirror write happens (i.e. only when the project has opted in), the HTML is checked against the same secret-shaped-content pattern VS-358 added for knowledge, and refused (nothing recorded, matching `putDoc`'s existing refusal shape) if it matches. An opted-out project's publish is unaffected — the artifact store has never had this check, and unlike a knowledge note, an artifact's body is already reviewed by a human as untrusted content before it is ever rendered, so the ticket only asks for the check on the path that newly exposes it to a repo.
- Extend `mergeDone`'s existing per-project reconciliation (added by VS-358, run right after `landDelivery` succeeds, inside the same per-project lock) to also diff `.weave/artifacts/**` between the landing's `beforeSha`/`afterSha`. For each changed `<TICKET-IDENTIFIER>/<key>` pair whose ticket exists in this project: if the landed HTML differs from what is already stored for that key (the common case — a worker's own publish — is already identical and is a no-op), record it as a new revision with a system/merge actor and update the artifact's title/kind from the metadata file if present. A path whose ticket identifier does not resolve to a ticket in this project, or whose file was deleted, is left alone and logged — there is no delete capability for a published artifact today, and inventing one as a side effect of sync is out of scope.
- The reconciled artifact still renders only through the existing sandboxed viewer and raw route with `ARTIFACT_CSP` — reconciliation is a caller of the same `putDocument`/`putArtifactWorkProduct` methods the tool already uses, never a new rendering path or a relaxation of the CSP.
- No new size cap: the existing `ARTIFACT_MAX_CHARS` (2,000,000 characters) already bounds what `weave_ticket_artifact_put` accepts, and reconciliation applies the same bound to a repo-landed file before recording it, so a git-committed artifact is never larger than one the tool already allows into the database today.
- No settings UI change (the flag already has one, from VS-358) and no artifact-viewer change.

## Capabilities

### New Capabilities
- `artifact-repo/worker-write-path`: a worker's `weave_ticket_artifact_put` call for an opted-in project also lands the HTML and its title/kind metadata in the worktree, to be committed and reviewed with the ticket's other changes.
- `artifact-repo/repo-write-boundary`: only the publishing ticket's own `<TICKET-IDENTIFIER>/<key>` path can ever be written by the mirror; a workspace-scoped (weaver) artifact is never written to any repo.
- `artifact-repo/secret-refusal`: a mirror write refuses secret-shaped HTML before it reaches a repo, for an opted-in project.
- `artifact-repo/merge-sync`: when an opted-in project's ticket lands, a changed `.weave/artifacts/**` file becomes a new artifact revision with a merge actor; an unmatched ticket or key is left alone and logged.

### Modified Capabilities
(none — every changed requirement here is new behavior gated on the existing, default-off `knowledgeRepo.enabled` flag; nothing existing changes shape.)

## Impact

- `packages/core/src/tickets/service.ts` (`putDocument`'s artifact path gains an optional mirror write; `mergeDone`'s existing knowledge reconciliation call site also drives an artifact reconciliation), `packages/core/src/knowledge/repoSync.ts` or a sibling `packages/core/src/artifacts/repoSync.ts` (the diff/reconcile logic, modeled on `changedKnowledgePaths`/`reconcileProjectKnowledgeFromRepo`).
- `packages/core/src/artifacts/files.ts` (new, or a `tickets/` sibling) — `repoArtifactPath(ticketIdentifier, key)` boundary helper, mirroring `knowledge/files.ts`'s `repoKnowledgePath`.
- `packages/server/src/tools.ts` (`weave_ticket_artifact_put` handler: build the mirror target from the calling worker's own worktree, exactly as `mirrorTargetFor` already does for knowledge, and run the secret check before it).
- Tests: `packages/core/src/tickets/*.test.ts` (mirror write, boundary, merge-sync reconciliation, no-op on an unchanged worker-published file), using temporary git repos, never the live daemon.
- No changes to `packages/shared/src/config.ts`, `packages/db` migrations, `packages/ui`, or the artifact viewer/CSP.
