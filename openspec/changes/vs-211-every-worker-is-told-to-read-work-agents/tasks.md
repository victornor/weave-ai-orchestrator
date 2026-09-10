## 1. Compute the existence checks

- [x] 1.1 In `packages/core/src/prompts/index.ts`, extend `WorkerTemplateData.worktree` with `hasAgentsFile: boolean` and `hasOpenspecConfig: boolean`, and compute both in `workerData()` via `existsSync(join(agent.worktreePath, 'AGENTS.md'))` / `existsSync(join(agent.worktreePath, 'openspec', 'config.yaml'))`, `false` when `agent.worktreePath` is null (curation tickets).

## 2. Make the templates conditional

- [x] 2.1 In `templates/brief.md.tmpl`'s Setup section, wrap "Then read `work/AGENTS.md` … once …" in `{{#if worktree.hasAgentsFile}}`, and add an `{{#unless worktree.hasAgentsFile}}` branch stating plainly the project has none.
- [x] 2.2 In `templates/brief.md.tmpl`'s Context pointers list, wrap the `work/AGENTS.md` bullet in `{{#if worktree.hasAgentsFile}}` and the `work/openspec/config.yaml` bullet in `{{#if worktree.hasOpenspecConfig}}`.
- [x] 2.3 In `templates/worker.AGENTS.md.tmpl`'s "Each turn" step 2, wrap the "read `work/AGENTS.md` once …" clause the same way, with an `{{#unless}}` branch saying the project has none.
- [x] 2.4 In `templates/worker.AGENTS.md.tmpl`'s "Git" section, wrap the `work/AGENTS.md` / `work/openspec/config.yaml` mentions in their respective `{{#if}}` blocks.
- [x] 2.5 In `packages/core/src/prompts/defaults.ts`'s `BRIEF_TMPL` fallback, wrap the Setup sentence's `work/AGENTS.md` mention the same way (mirrors 2.1, no Context-pointers section exists in the fallback).

## 3. Tests and delivery

- [x] 3.1 In `packages/core/src/prompts/render.test.ts`, add cases that render the brief and the worker instructions against a worker whose `worktreePath` points at a real temp directory: one with `AGENTS.md` present (asserts the read instruction and the Context-pointers bullet appear), one without (asserts neither appears, the "has none" sentence appears, and no failed-read wording is implied). Cover `openspec/config.yaml` the same way. Extend the existing `it.runIf(existsSync(SHIPPED_TEMPLATES))` cases so the shipped templates are asserted too, not just the fallback.
- [x] 3.2 Run `pnpm lint && pnpm typecheck && pnpm test` and confirm all are green.
- [x] 3.3 Open the PR, record it on the ticket. State in the PR description which other unconditionally-named project-repo paths were found (`work/openspec/config.yaml`, fixed here; the `agent-conductor-worker` skill's own mentions and `charter.md.tmpl`'s hedged fallback prose, left unchanged with reasons per design.md).
