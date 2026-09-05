## 1. The budgets become configuration

- [x] 1.1 Add `defaults.knowledgeBudgetTokens` to `WorkspaceDefaultsSchema` (`packages/shared/src/config.ts`) — keys `workspace`, `shared`, `decisions`, `project`, `document`, each `z.number().int().min(500)` with the defaults from design.md, the whole block optional — and raise `bootstrapBudgetTokens` to 16000; verify `WorkspaceConfigSchema.parse` of a minimal config yields those defaults and that a partial block keeps its siblings' defaults (new test in `packages/core/src/knowledge/knowledge.test.ts` or the loader test, wherever the config is already parsed).
- [x] 1.2 In `packages/core/src/knowledge/files.ts`, keep `BUDGETS`/`DOC_BUDGET` as the fallback used when no workspace config is in play and re-point them at the new defaults so nothing quotes 1500 in two places; verify `pnpm typecheck` and the existing `seeds every knowledge file with its sections and budget` test still passes.

## 2. The configured budget is the one enforced

- [x] 2.1 Add a single `budgetFor(scope, isDoc)` resolution point in `packages/core/src/knowledge/service.ts` reading `ctx.config.defaults.knowledgeBudgetTokens`, and route every budget read through it — `ensure` (row creation and the out-of-band-edit path), `write`, `note`, `replace`, `putDoc`, `lint`, `docSummaryOf`, `appendDecision`; verify a unit test that changes `ctx.config.defaults.knowledgeBudgetTokens.project` between two `note` calls sees the second measured against the new value with no restart.
- [x] 2.2 Refresh `knowledge_files.budget_tokens` when it disagrees with the resolved budget (at `ensure` and in `write`), so the column, the `knowledge.updated` payload and `GET /knowledge` mirror the configuration; verify a test that seeds a row at an old budget, changes the config, writes, and asserts the row and the emitted event carry the new value.
- [x] 2.3 Verify the read paths report the configured budget: a test asserting `get`, `listDocs`, `getDoc` and `lint` all return the configured numbers after a config change (acceptance criterion: `ac_knowledge_get` and `ac_knowledge_docs` report the configured budget).

## 3. Rejection and curation at the configured size

- [x] 3.1 Verify — with tests, no new code expected — that `note` rejects with `budget_exceeded` and schedules curation exactly at the configured budget: one test at a small configured budget (rejected, curation scheduled, entry not written) and one where the same entry fits after the budget is raised (written).
- [x] 3.2 Verify the 80 % trigger follows the configured budget: a write that lands between 80 % and 100 % of a configured budget is accepted and schedules a curation run.

## 4. The budget a file states in its own text

- [x] 4.1 Render the configured budget into the seeded hub skeletons — `PROJECT_SKELETON` and the workspace/shared/decisions skeletons in `packages/core/src/workspace/loader.ts`, and `seedBody` in `packages/core/src/knowledge/files.ts` (both seed paths, per the project KB's note that they must change together); verify a test that seeds a workspace with a non-default budget and asserts the seeded text states that number.
- [x] 4.2 In the `write` path, correct the number inside a leading `<!-- ... Budget N tokens ... -->` marker when it disagrees with the configured budget, changing nothing else; verify a test that writes to a file seeded with `Budget 1500 tokens` under a 10000 budget and asserts the marker now says 10000, the rest of the body is byte-identical, and a file with no marker is untouched.

## 5. Changing the settings

- [x] 5.1 Replace the shallow spread in `PATCH /config` (`packages/server/src/routes/workspace.ts`) with a deep merge for plain objects, arrays replaced wholesale; verify a `packages/server/test` case that patches one nested default and asserts every sibling default and the `projects` array survive unchanged.
- [x] 5.2 Add `conductor workspace set-default <key=value...>` (`packages/cli/src/commands/workspace.ts`), mirroring `project set-policy`, with dotted keys for one level of nesting and help text listing the budget keys; verify `packages/cli/src/program.test.ts` sees the command in the tree and a unit test of the key parsing turns `knowledgeBudgetTokens.project=10000` into the right patch object.
- [x] 5.3 Add a *Knowledge budgets* group to Settings → Workspace (`packages/ui/src/routes/Settings.tsx`): number fields for the five budgets and the bootstrap digest, seeded from the workspace summary's config and saved through `usePatchConfig`; verify a `packages/ui/src/test/components.test.tsx` case that renders the section, changes a field and asserts the patch body carries only that key.
- [x] 5.4 Reject an invalid value with a message naming the setting — the schema's `min(500)`/int rules surfaced as an API validation error and, in the UI, an input that will not submit a non-number; verify a server test asserting a `PATCH /config` with a zero budget is rejected and the stored config is unchanged.

## 6. The bootstrap digest

- [x] 6.1 Verify a worker's digest carries a full-size `SHARED.md` and project KB without truncating: a test that fills both to their configured budgets and asserts `truncated` is false under the default digest budget, plus the existing small-budget test still showing truncation when the digest budget is set below the content.

## 7. Documentation and the skills layer

- [x] 7.1 Update the numbers and the "where the budget comes from" wording in `docs/PLAN.md` §13.1, `docs/API.md` (the 1500-tokens-per-document line), `templates/knowledge/*.md`, `README.md` where it describes the budgets, and `skills/agent-conductor-knowledge/references/documents.md:11`; verify `rg '1500'` over those paths returns nothing that still describes a knowledge budget.
- [x] 7.2 Document `conductor workspace set-default` in the CLI table in `README.md` alongside the other workspace commands; verify the command's `--help` and the README row agree.

## 8. Green

- [x] 8.1 Run `pnpm typecheck`, `pnpm lint` and `pnpm test` from the repo root and verify all three pass with no new warnings.
