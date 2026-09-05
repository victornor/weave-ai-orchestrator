## Why

A project knowledge base is capped at 1500 tokens (`packages/core/src/knowledge/files.ts:5`) and a linked document at the same (`:7`). On 2026-09-05 the `agent-conductor` project KB reached that cap within a day of use: `ac_knowledge_note` now rejects with `budget_exceeded` and schedules a curation run instead of recording what the worker learned. 1500 tokens is roughly 40 one-line entries for a whole project — the memory that is supposed to carry across every ticket is full before the second week.

The number is a constant, so the workspace owner cannot change it without a code change and a release. Everything else that shapes how much context an agent gets — `bootstrapBudgetTokens`, timeouts, concurrency — is a workspace default in `workspace.yaml` (`packages/shared/src/config.ts:43-62`). The budgets are the exception, and they are the one the owner actually wants to turn up.

Two things stand between the constants and a setting:

- **The budget is copied into the database.** `knowledge_files.budget_tokens` is written once from `BUDGETS[scope]` when the row is created (`packages/core/src/knowledge/service.ts:76`) and every check reads the row, not the config (`:93`, `:194`, `:286-296`, `:308`, `:338`, `:549`). Raising a default would leave every existing workspace on 1500 forever.
- **`PATCH /config` merges one level deep.** `{ ...ws.ctx.config, ...patch }` (`packages/server/src/routes/workspace.ts:26`) replaces the whole `defaults` block with whatever the client sent, and the schema then re-fills the missing keys with *their* defaults — so a settings screen that changes one default silently resets every other one it did not send.

Raising the project KB to 10000 tokens also makes it the largest thing injected into a worker, so the bootstrap digest budget (8000, `config.ts:58`) has to move with it or every worker's first turn starts with a truncated KB.

## What Changes

- **The budgets become workspace defaults.** A new `defaults.knowledgeBudgetTokens` block in `workspace.yaml` carries one value per hub file plus one for linked documents. Defaults: project **10000**, document **10000**, workspace **10000**, decisions **4000**, shared **2000** (shared is read by every agent, so it stays the smallest on purpose).
- **The configured value is the one that is enforced.** Every budget check, every reported budget and the curation trigger read the workspace config, not the row that was written when the file was first seen. `knowledge_files.budget_tokens` becomes a mirror of the configured value, refreshed when it drifts, so events, `GET /knowledge` and the UI keep working unchanged.
- **A change takes effect on the next write.** `saveConfig` already updates the in-memory config (`packages/core/src/workspace/loader.ts:228`); nothing caches a budget beyond it, so no restart is needed.
- **Existing workspaces upgrade.** A `workspace.yaml` that has never set a budget has no key to preserve, so it picks up the new defaults; a workspace that sets one keeps it. The stale `Budget 1500 tokens` line seeded into existing hub files is corrected on that file's next write, so agents stop reading a number the daemon no longer enforces.
- **The bootstrap digest budget rises with them.** `bootstrapBudgetTokens` defaults to **16000**, above the 12000 a worker's digest can now reach (shared 2000 + project 10000), so nothing truncates. The plan states the resulting per-worker cost (design.md — Context).
- **The owner can change them from the web app and the CLI.** Settings → Workspace gains a *Knowledge budgets* group (the five budgets plus the bootstrap digest); the CLI gains `conductor workspace set-default <key=value...>`, the workspace-level twin of `conductor project set-policy`.
- **`PATCH /config` merges deeply.** Nested config objects are merged key by key instead of replaced wholesale; arrays are still replaced. **BREAKING** for a client that relied on `PATCH /config` clearing keys inside `defaults`, `conductor` or `presentation` by omitting them — the documented way to clear one is now to send its value explicitly.

## Capabilities

### New Capabilities

- `knowledge/budgets`: how much a knowledge file may hold, where that limit comes from, how the human changes it, and what happens at the limit — the sizes reported by the read paths, the write that is rejected, and the curation run that is scheduled.

### Modified Capabilities

(None. `openspec/specs/` holds no capabilities yet.)

## Impact

- `packages/shared/src/config.ts` — `defaults.knowledgeBudgetTokens` added; `bootstrapBudgetTokens` default raised.
- `packages/core/src/knowledge/files.ts` — `BUDGETS` / `DOC_BUDGET` become the fallback used when no config is in play; a helper to read the budget comment in a seeded preamble.
- `packages/core/src/knowledge/service.ts` — one place resolves a file's effective budget from `ctx.config`; the note, replace, put-document, digest, lint and curation paths use it; the row is refreshed when it drifts.
- `packages/core/src/workspace/loader.ts` — the seeded hub skeletons state the configured budget instead of a hardcoded one.
- `packages/server/src/routes/workspace.ts` — deep merge for `PATCH /config`.
- `packages/cli/src/commands/workspace.ts` — `set-default`.
- `packages/ui/src/routes/Settings.tsx` — the *Knowledge budgets* group.
- `templates/knowledge/*.md`, `docs/PLAN.md` §13.1, `docs/API.md`, `skills/agent-conductor-knowledge/references/documents.md` — the numbers they quote.
- Tests: `packages/core/src/knowledge/knowledge.test.ts` (defaults, override, rejection at the configured size, digest), `packages/server/test/app.test.ts` (deep merge), `packages/cli/src/program.test.ts` (the new command), `packages/ui/src/test/components.test.tsx` (the settings group).
- No migration, no new table or column, no new HTTP route, no new event type. Nothing in the run engine, the wake queue or the curation worker changes beyond the number they read.

## Out of scope

- What curation does, or when it runs, beyond reading the configured budget.
- Per-project budget overrides. Every project in a workspace gets the same project-KB budget; a per-project override is a follow-up if the owner wants one.
- The duplication between a worker's `AGENTS.md` (which already embeds `SHARED.md` and the project KB, `templates/worker.AGENTS.md.tmpl:66-73`) and the bootstrap digest, which repeats both on the first turn. It becomes the largest single cost of this change and is measured in design.md, but removing it changes what a worker is told and belongs in its own ticket.
- The 60-word cap on a single entry, the near-duplicate check, and the 80 %-of-budget curation trigger ratio. All keep today's behavior against the new number.
