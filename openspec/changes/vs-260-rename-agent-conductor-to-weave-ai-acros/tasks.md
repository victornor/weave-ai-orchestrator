## 1. Package scope: `@agent-conductor/*` → `@weave-ai/*`

- [x] 1.1 Rename the `name` field of every scoped `package.json` (27 files: the direct `packages/*`
      packages plus `packages/runtimes/*`, `packages/channels/*`, `packages/surfaces/*`, and
      `examples/plugins/echo-channel`) and every internal `dependencies` entry naming
      `@agent-conductor/*`. Update the root `package.json`'s `typecheck`/`dev` filter targets and its
      `private` name, `pnpm-workspace.yaml` if it names any, `vitest.config.ts`, the Dockerfile
      (`pnpm --filter @agent-conductor/ui build`), and `examples/plugins/README.md`. Run
      `pnpm install` to regenerate `pnpm-lock.yaml`; verify by hand that the lockfile's
      `@agent-conductor` entries are gone and commit the regenerated lockfile. Verify
      `pnpm typecheck` before committing.

- [x] 1.2 Rewrite every cross-package import specifier `@agent-conductor/` → `@weave-ai/` across all
      `.ts`/`.tsx` sources (~399 files) — a mechanical replace, but confirm there is no second source
      of truth first (no `paths` block in `tsconfig.base.json`/`tsconfig.json`, no `.npmrc`, no import
      map). Verify `pnpm typecheck` is clean and `rg '@agent-conductor' packages/ examples/` returns
      only archived/historical matches. Commit.

## 2. CLI and daemon binaries

- [x] 2.1 `packages/cli/package.json`: change the `bin` key `conductor` → `weave`. `packages/cli/src/program.ts`:
      change `.name('conductor')` → `.name('weave')` and the description's `AgentConductor` brand to
      the new one. Change the root `package.json`'s `"conductor"` convenience script to `"weave"`.
      Verify `weave --help` (built CLI or the program unit test) renders `weave`, not `conductor`.
      Commit.
- [x] 2.2 `packages/server/package.json`: change the `bin` key `ac-daemon` → `weave-daemon`. Sweep the
      remaining `ac-daemon` references (docs, service unit examples, comments) to `weave-daemon`.
      Commit.
- [x] 2.3 Sweep the documented command examples and prose: `README.md`'s `conductor <command>` table
      and walkthroughs, `docs/PLAN.md`, `docs/API.md`, `docs/OPERATIONS.md`, `docs/DOCKER.md`,
      `docs/SCENARIOS.md`, `docs/demos/*`, skill references, and `templates/`. Move only the sites that
      name the CLI binary or the product — not the English "conductor" that names the agent role.
      Replace the `conductor://` URL convention with `weave://` in
      `skills/weave-ai-worker/SKILL.md`, `skills/weave-ai-worker/references/delivery.md` and
      `docs/prompts/skills.md`. Commit.

## 3. Service and MCP identifiers

- [x] 3.1 `packages/release/src/index.ts`: `SERVICE_NAME = 'weave-ai.service'`,
      `LAUNCHD_LABEL = 'com.weave-ai.daemon'`; update the doc comments in the same file and
      `packages/cli/src/daemon.ts` that name the old unit/label. Commit.
- [x] 3.2 `packages/server/src/mcp.ts`: `MCP_SERVER_NAME = 'weave-ai'`. Replace the literal
      `agentconductor` MCP-config key in `packages/core/src/runs/engine.ts` with the shared constant so
      the registered name and the run-config key cannot drift, and update the runtime arg tests and
      `examples` fixtures that spell `agentconductor`. Verify the `mcp.ts` size-cap `Set` still names
      the (renamed in task 5) list tools. Commit.

## 4. Skills, manifest and install lists

- [x] 4.1 Rename all nine `skills/agent-conductor-*` directories to `skills/weave-ai-*`, and update
      every internal self-reference to the skill's own name. Update `skills/manifest.json`'s entries
      (names only — the `audience` vocabulary was already renamed by VS-263), `skills/README.md`, and
      every cross-reference between skills. Commit.
- [x] 4.2 `packages/core/src/workers/home.ts`: update the hardcoded `CONDUCTOR_SKILLS` and
      `WORKER_SKILLS` arrays to the new `weave-ai-*` names (this is what actually decides what reaches
      an agent home — a manifest entry alone does not install a skill). Rename the `CONDUCTOR_SKILLS`
      identifier if the surrounding code allows. `packages/core/src/artifacts/kit.ts`: update the
      `agent-conductor-artifacts` path literal and its doc comment. Update the tests that assert these
      names (`home.test.ts`, `kit.test.ts`, `render.test.ts`). Verify the core and prompts suites.
      Commit.

## 5. MCP tool names: `ac_*` → `weave_*`

- [x] 5.1 Enumerate the registered set from `packages/shared/src/tools.ts` (do not trust a count from
      the ticket): rename every `ac_*` string in `COMMON_TOOLS`, `WEAVER_TOOLS`, `WORKER_ONLY_TOOLS`
      and `HUMAN_REPLY_TOOL`. Rename the same names in `packages/server/src/tools.ts` (all tool
      definitions), and the two-name `Set` in `packages/server/src/mcp.ts`. Verify the shared and
      server sets are identical (no name present in one and absent from the other) and
      `pnpm vitest run packages/shared packages/server` passes. Commit.
- [x] 5.2 Rename every `ac_*` tool name in code that builds prompts or defaults
      (`packages/core/src/prompts/defaults.ts`, `index.ts`, and their tests), and in the
      agent-facing prose: the shipped `skills/weave-ai-*` files, `templates/*.tmpl`, `docs/`
      (including `PLAN.md`, `API.md`, the ADRs, prompts and demos) and `packages/core/src/**` doc
      comments. Commit.
- [x] 5.3 Add the invariant test from design.md Decision 3: extract every tool name matching the new
      prefix from the agent-facing prose (shipped skills, templates, core prompts, docs) and assert
      each is a member of the registered tool-name set. Verify it fails when a prose name is
      deliberately misspelled and passes otherwise. Commit.

## 6. Branding prose and templates

- [x] 6.1 Update the brand and product name in `README.md`, `LICENSE` (header/project line if it names
      the project), `CLA.md`, `CLAUDE.md`, `ee/README.md`, `ee/LICENSE`, the Dockerfile header,
      `examples/plugins/README.md` and `examples/plugins/echo-channel/index.js`. Read each
      `agent-conductor`/`AgentConductor` site; do not blind-replace prose that would read wrong.
      Commit.
- [x] 6.2 Sweep the shipped `templates/*.tmpl` (including `weaver.AGENTS.md.tmpl` and
      `worker.AGENTS.md.tmpl`) for product-name and tool-name references, reading each occurrence as
      VS-259's task did. Verify `pnpm vitest run packages/core/src/prompts` passes, asserting rendered
      content rather than the absence of the old word. Commit.

## 7. Final verification

- [x] 7.1 After the **last rebase** (not before), re-run the sweep on the commit being merged:
      `rg '@agent-conductor'` over live source/config (excluding `openspec/changes/archive/**` and
      accepting only non-package-name/non-import prose) and `rg 'ac_[a-z]'` over the registered and
      prose sites, until clean. Record in the delivery report exactly when this sweep ran relative to
      the final commit. Commit any fix.
- [x] 7.2 Fresh-install proof: with a scratch `HOME`/`XDG_CONFIG_HOME`/`XDG_DATA_HOME` and a
      throwaway config directory, build and start the daemon and drive it with the CLI under the new
      names; assert the directories created are the new-named ones and no real coding CLI is launched.
      Capture the commands and output as evidence.
- [x] 7.3 Existing-install proof: seed a temp root with an old-named `.agent-conductor/db.sqlite` and
      an old-named user config directory, resolve the paths through the renamed code, and assert the
      old-named state directory and agent home are still found with nothing created or moved
      alongside. Capture the evidence.
- [x] 7.4 Run `pnpm lint`, `pnpm typecheck`, and `pnpm test` from the repo root; paste **both** suite
      blocks verbatim with their real totals (core/server and UI are separate) into the delivery
      report. Deliver the PR (one branch, one PR, many commits), name the three service identifiers in
      the PR description, and transition to `in_review`.
