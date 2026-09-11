## Why

captain wants agents able to publish rich, self-contained HTML artifacts (architecture explainers,
diagrams, before/after views, comparison tables) that render offline and look like AgentConductor.
The storage question (ticket documents vs. knowledge base) is still open with captain, but the
styling kit, the authoring guidance and the on-demand tool that discloses both do not depend on the
answer — they can land now, ahead of the storage-dependent authoring/serving/viewer ticket.

## What Changes

- Extract the CSS custom-property token block currently hand-authored only in
  `packages/ui/src/index.css` into a shared TypeScript source, `ARTIFACT_KIT_CSS`, so a static HTML
  artifact can carry AC's look with zero build step and zero risk of silently drifting from the app.
- Add a drift test that parses the token block from both sources and fails the moment either changes
  without the other.
- Add `skills/agent-conductor-artifacts/`: a `SKILL.md` plus `references/` playbooks (original text)
  covering when an artifact is worth making, the format rules, and diagram/table/comparison/plan/
  code/change playbooks. Register it in `skills/manifest.json`, `skills/README.md`, and name its
  trigger in both `templates/worker.AGENTS.md.tmpl` and `templates/conductor.AGENTS.md.tmpl`.
- Add the `ac_artifact_kit` MCP/REST tool (no input) returning `{ css, tokens, components, playbooks }`
  so an agent fetches the kit and its reference material on demand rather than carrying it in every
  prompt. Register it through the existing tool seam (`packages/shared/src/tools.ts`,
  `packages/server/src/tools.ts`) and document it in `docs/PLAN.md` §9.2.

## Capabilities

### New Capabilities
- `artifact-kit/design-tokens`: the AC Artifact Kit CSS itself — token scope, semantic class layer,
  layout-safety rules, and the drift guarantee against `packages/ui/src/index.css`.
- `artifact-kit/skill`: the `agent-conductor-artifacts` skill — its presence, manifest/README
  registration, trigger naming, and playbook content rules.
- `artifact-kit/tool`: the `ac_artifact_kit` tool — its contract, scope, and response shape.

### Modified Capabilities
(none — this is new surface; no existing requirement's behavior changes)

## Impact

- New: `packages/core/src/artifacts/kit.ts` (`ARTIFACT_KIT_CSS`, token/component/playbook data),
  `packages/core/src/artifacts/kit.test.ts` (drift test).
- Modified: `packages/shared/src/tools.ts` (new `ToolName`), `packages/server/src/tools.ts` (new
  `ToolDef`), `docs/PLAN.md` §9.2, `skills/manifest.json`, `skills/README.md`,
  `templates/worker.AGENTS.md.tmpl`, `templates/conductor.AGENTS.md.tmpl`.
- New skill directory: `skills/agent-conductor-artifacts/SKILL.md` +
  `skills/agent-conductor-artifacts/references/*.md`.
- No DB migration, no new route, no UI change. Explicitly excluded from this ticket:
  `ac_ticket_artifact_put`, the raw serve route and its CSP, and the Artifact tab/viewer — all of
  which depend on the still-open storage decision and land in a follow-up ticket.
