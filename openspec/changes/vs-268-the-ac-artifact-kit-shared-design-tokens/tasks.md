## 1. The AC Artifact Kit

- [x] 1.1 Create `packages/core/src/artifacts/kit.ts` exporting `ARTIFACT_KIT_CSS` (base layer, layout-safety rules, the dark/light token block scoped to design.md Decision 2's allowlist, and the semantic component layer from Decision 4: `.page` `.section` `.card` `.panel` `.btn` `.badge`/`.status-*` `.table` `.code`/`.kbd` `.steps`/`.timeline`) plus the exported `ARTIFACT_KIT_TOKEN_NAMES` allowlist constant. Verify `pnpm typecheck` passes for `packages/core`.
- [x] 1.2 In the same module (or a sibling `parse.ts`), write the small regex-based CSS custom-property parser used by both the tool and the drift test, taking CSS text plus a region marker and returning `Record<string, string>`. Verify a focused unit test parses a hand-written CSS snippet into the expected map.
- [x] 1.3 Write `packages/core/src/artifacts/kit.test.ts`: parse `packages/ui/src/index.css` (read via the relative fs path, not an import) and `ARTIFACT_KIT_CSS` into their three regions (dark, light, theme-independent scale), and assert every allowlisted token name has an equal value in both. Verify `pnpm vitest run packages/core/src/artifacts/kit.test.ts` is green.
- [x] 1.4 Add the discriminating negative case to the same test file: take one parsed kit value, mutate it in memory, and assert the comparison now fails — proving the assertion isn't vacuous. Verify the mutated case fails as expected, the unmutated case passes.
- [x] 1.5 Demonstrate real drift end to end for the delivery report: temporarily change one allowlisted token's value in `ARTIFACT_KIT_CSS` only, run `pnpm vitest run packages/core/src/artifacts/kit.test.ts`, capture the red output, then revert the change and confirm green again. Paste both outputs in the PR/report — this is acceptance criterion 1, not just the permanent test from 1.3/1.4.

## 2. Offline rendering proof

- [x] 2.1 Assemble a throwaway HTML file (not committed) that inlines only `ARTIFACT_KIT_CSS` and exercises the base layer, layout-safety rules, and every semantic component class, in both the default (dark) theme and `[data-theme='light']`. Open it directly from local disk (`file://`) with no dev server running; verify by screenshot (uncommitted, path reported per the shared screenshot convention) that both themes render correctly with no missing styles. State in the report that no network request occurred (e.g. devtools network panel empty, or note the file has zero external references by construction — no `<script>`, no non-`data:` URL).

## 3. The `agent-conductor-artifacts` skill

- [x] 3.1 Create `skills/agent-conductor-artifacts/SKILL.md` (frontmatter `name`/`description` per `skills/README.md`'s conventions) covering: when an artifact is warranted vs. a comment; the format rules (single self-contained HTML, inline CSS/SVG, data-URI images, no external fetches, use the kit); a pointer to `references/` for the playbooks. Verify it stays under 250 lines per the skill-writing convention.
- [x] 3.2 Write `skills/agent-conductor-artifacts/references/` playbooks as original text: diagram (default to hand-authored inline SVG with `currentColor` and the tokens, short labels, `path:line` citations), table, comparison, plan, code, and change (before/after, files changed, impact). Verify each file is original prose, not copied from another project's docs.
- [x] 3.3 Register the skill in `skills/manifest.json` (`name: agent-conductor-artifacts`, `audience: all`, one-line `description`) in the same shape as existing entries. Verify the file stays valid JSON and the new entry matches the schema of the others.
- [x] 3.4 Add a row for the skill to `skills/README.md`'s table. Verify the row is present and the audience matches the manifest.
- [x] 3.5 Name the skill's trigger in `templates/worker.AGENTS.md.tmpl` (extend the "Procedures live in skills" line) and in `templates/conductor.AGENTS.md.tmpl` (extend its skills-list line). Verify both templates mention `agent-conductor-artifacts` and state when to load it.

## 4. `ac_artifact_kit`

- [x] 4.1 Add `'ac_artifact_kit'` to `COMMON_TOOLS` in `packages/shared/src/tools.ts`. Verify `pnpm typecheck` passes.
- [x] 4.2 Add the `ToolDef` in `packages/server/src/tools.ts`: `scope: 'all'`, `input: z.object({})`, handler building `{ css: ARTIFACT_KIT_CSS, tokens, components, playbooks }` from `kit.ts`'s exports, with `playbooks` read from `ctx.ws.ctx.skillsDir` via the `readArtifactPlaybooks` helper (design.md Decision 5). Verify a test in `packages/server/test/mcp.test.ts` (or a sibling file), following the existing `dispatches a tool call` pattern, calls `ac_artifact_kit` as both a worker and a conductor token and asserts the response has non-empty `css`, the expected token names, and the `playbooks` keys from step 3.2.
- [x] 4.3 Add `readArtifactPlaybooks(skillsDir: string): Record<string, string>` to `kit.ts`, reading `${skillsDir}/agent-conductor-artifacts/references/*.md`, mirroring `packages/core/src/workers/home.ts`'s missing-directory-returns-empty behavior. Verify a unit test covers both the present-directory and missing-directory cases.
- [x] 4.4 Document `ac_artifact_kit()` in `docs/PLAN.md` §9.2's "Common (all agents)" list, in the same one-line style as the other entries. Verify the line is present and accurately describes the response shape.

## 5. Checks

- [x] 5.1 `pnpm lint && pnpm typecheck && pnpm test` all green. Paste both `pnpm test` suite blocks verbatim (core/server suite and UI suite) with their real totals in the delivery report — never just one, never a retyped combined figure.
