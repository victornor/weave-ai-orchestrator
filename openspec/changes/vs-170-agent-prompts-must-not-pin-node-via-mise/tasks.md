## 1. Always-loaded templates

- [x] 1.1 Add a Host CLIs note to `templates/conductor.AGENTS.md.tmpl` after Hard rules: do not add or keep a `mise.toml` (or equivalent) Node pin that hides host CLIs such as `openspec`; do not copy `package.json` engines from another repository into a pin; if OpenSpec is missing only inside a mise-pinned repo, remove or align the pin — do not ask the human to reinstall the CLI or change the machine Node. Carve the same exception out of the "needed credential" line under How you talk. Verify the shipped source contains `mise.toml`, `openspec`, and "reinstall".
- [x] 1.2 Add a Host CLIs note to `templates/worker.AGENTS.md.tmpl` after Hard rules with the same three rules, including not asking the human or the conductor to reinstall the CLI. Verify the shipped source contains `mise.toml`, `openspec`, and "reinstall".

## 2. Tests and delivery

- [x] 2.1 In `packages/core/src/prompts/render.test.ts`, add a shipped-template case (next to the existing `it.runIf(existsSync(SHIPPED_TEMPLATES))` cases) that rendered conductor and worker instructions both mention `mise.toml`, `openspec`, and not asking the human to reinstall. Verify `pnpm vitest run packages/core/src/prompts/render.test.ts` passes.
- [x] 2.2 Run `pnpm lint && pnpm typecheck && pnpm test` and confirm all are green.
- [x] 2.3 Open the PR, record it on the ticket, and state that SIDE-3/SIDE-4 and the other workspace's pin were left unchanged on purpose. Rebase onto main first if [VS-169](conductor://tickets/VS-169) has landed on the same templates.
