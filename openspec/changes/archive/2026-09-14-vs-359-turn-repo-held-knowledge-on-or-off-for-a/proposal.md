## Why

VS-358 lets a project opt in to keeping its knowledge in its own repo (`.weave/knowledge/`), but a human flipping the new flag only changes a database column: no existing workspace knowledge moves into the repo, and no repo copy is ever removed. Moving knowledge into a repository is exactly the moment a human should review what enters it, and it is the moment a public repository becomes a disclosure risk the daemon can currently neither see nor warn about. This closes both gaps for a project that already exists.

## What Changes

- **Turning the switch on for an existing project** no longer flips the flag directly. The daemon copies the project's whole workspace knowledge tree (`knowledge/projects/<id>/**` — `PROJECT.md`, `docs/`, `archive/`) into `.weave/knowledge/` on a fresh branch off the landing tip and opens one pull request for review. The flag stays off until that PR merges. `knowledge_revisions` is not replayed into git; the PR's commit is the first git revision.
- **Turning the switch off** opens the inverse PR, deleting `.weave/knowledge/` from the repo. On merge the flag goes off; the workspace copy is never touched, so nothing is lost.
- Closing either PR unmerged leaves the flag exactly as it was.
- A new optional forge capability, `ForgeAdapter.repoInfo?(cwd, remote?)` returning `{ private: boolean } | null`, implemented for the built-in `gh` adapter with `gh repo view --json visibility`. Where the forge reports the repo public, the V1/V2 project settings (creation checkbox and existing-project toggle) show a clear advisory warning before the switch is confirmed. On a private repo, or a forge without the capability, nothing is shown.
- The project row shows the switch in progress — "waiting for the pull request to merge", with a link to the PR and how to cancel by closing it.
- Two new read-only project routes: repo visibility for one project and for a not-yet-created URL.

## Capabilities

### New Capabilities
- `knowledge-repo/switch-migration`: turning the knowledge-repo opt-in on or off for an existing project through exactly one reviewed pull request, whose merge (not the request) is what flips the flag, and whose close unmerged is a no-op.
- `knowledge-repo/public-visibility`: an optional forge capability that reports whether a repository is public, and the advisory UI warning it drives when a project is switched on.

### Modified Capabilities
- `knowledge-repo/opt-in`: turning the opt-in on for an existing project now begins a reviewed migration rather than enabling it immediately; the flag changes only when the migration's pull request merges.
- `knowledge-repo/settings-ui`: the existing-project toggle now warns when the repository is public and shows the pending switch instead of flipping immediately; the creation checkbox warns too.

## Impact

- `packages/plugin-sdk/src/index.ts` — new optional `ForgeAdapter.repoInfo?`.
- `packages/core/src/forge/gh.ts` — `gh repo view --json visibility` implementation plus a pure mapper.
- `packages/core/src/knowledge/` — a new switch module (copy-in / remove-out, branch + PR, pending record) built on VS-358's scratch-worktree and repo-delivery primitives.
- `packages/core/src/projects/index.ts` — `update` routes a flag change through a switch; a new `applyKnowledgeRepoSwitch`; two `repoInfo` reads.
- `packages/core/src/supervisor/index.ts` — a reconcile step that polls a pending switch's PR and flips or clears it.
- `packages/db/src/migrations/` — a new `projects.knowledge_switch_json` column; `packages/shared/src/types.ts` — `Project.knowledgeSwitch`.
- `packages/server/src/routes/projects.ts` — `GET /projects/:id/repo-info`, `GET /projects/repo-info?url=`.
- `packages/ui/src/routes/Settings.tsx` — warning and pending-switch state (V2 reuses the same section).
- `docs/API.md` — the two new routes.
