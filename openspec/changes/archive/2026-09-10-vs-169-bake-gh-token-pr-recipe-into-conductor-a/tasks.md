## 1. Always-loaded prompts

- [x] 1.1 Add a GitHub CLI note to `templates/conductor.AGENTS.md.tmpl` after Hard rules: if `gh auth status` looks logged-out, use `GH_TOKEN="$(gh auth token)"` for `gh` forge commands; do not run `gh auth login`; do not ask the human to authorize GitHub for that reason. Carve the same exception out of the "needed credential" line under How you talk. Verify the shipped source contains `GH_TOKEN="$(gh auth token)"` and `gh auth login`.
- [x] 1.2 Add one bullet to the Git section of `templates/worker.AGENTS.md.tmpl`: if `gh auth status` looks logged-out, use `GH_TOKEN="$(gh auth token)"` for `gh` forge commands; do not run `gh auth login`; do not ask the human or the conductor to authorize GitHub for that reason. Verify the shipped source contains those strings.
- [x] 1.3 In `skills/agent-conductor-worker/references/delivery.md`, prefix the `gh pr create` and `gh pr merge` commands with `GH_TOKEN="$(gh auth token)"`. Verify both commands carry the prefix and the file does not contain `gh auth login`.

## 2. Tests and delivery

- [x] 2.1 In `packages/core/src/prompts/render.test.ts`, add a shipped-template case (next to the existing `it.runIf(existsSync(SHIPPED_TEMPLATES))` cases) that rendered conductor and worker instructions both contain `GH_TOKEN="$(gh auth token)"` and forbid `gh auth login`. Verify `pnpm vitest run packages/core/src/prompts/render.test.ts` passes.
- [x] 2.2 Run `pnpm lint && pnpm typecheck && pnpm test` and confirm all are green.
- [x] 2.3 Open the PR, record it on the ticket, and state that operator `gh auth login` docs were left unchanged on purpose.
