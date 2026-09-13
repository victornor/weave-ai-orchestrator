# Tasks

## 1. Tool descriptions and error messages

- [x] 1.1 In `packages/server/src/tools.ts`, replace the role-noun prose "conductor" /
      "conductor-only" with "weaver" / "weaver-only" in the module comments, the `weave_inbox`,
      `weave_ticket_work_product`, `weave_ask`, `weave_knowledge_get`, `weave_knowledge_doc_put`,
      `weave_worker_message` and routine descriptions, and the two `OcError` messages
      (`workspace and decisions knowledge are conductor-only`, `projectId is required for the
      conductor`). Leave `conductor_request` (a wake source) untouched.

## 2. Skills and templates

- [x] 2.1 Replace the role-noun prose "conductor" with "weaver" across `skills/**` (SKILL.md files
      and `references/**`), including unblock/report `owner` spellings that still say `"conductor"`
      where the schema now requires `weaver`, and the `createdBy: conductor` row in
      `skills/weave-ai-hire/references/spec-schema.md`.
- [x] 2.2 Replace the role-noun prose "conductor" with "weaver" across `templates/**` (the four
      knowledge seeds).

## 3. README and current docs

- [x] 3.1 Replace role-noun prose "conductor" with "weaver" in `README.md` and fix the stale
      `conductor.AGENTS.md.tmpl` reference to `weaver.AGENTS.md.tmpl`.
- [x] 3.2 Replace role-noun prose "conductor" with "weaver" in the current user/operator docs
      (`docs/PLAN.md` where it describes current behaviour, `docs/OPERATIONS.md`,
      `docs/SCENARIOS.md`, `docs/DOCKER.md`) and the reproducible `docs/demos/*` scripts, along with
      the capitalised `Conductor` role labels in the same files. `docs/API.md` needs no change (its
      occurrences are all legacy key names or a capability id). Leave wire values, config keys,
      paths, identifiers and historical records (dated ADRs, superseded `docs/prompts/` drafts)
      untouched.

## 4. Verify

- [x] 4.1 Add/adjust a test asserting the knowledge error reads `weaver-only`, and keep
      `packages/shared/src/tools.test.ts` green.
- [x] 4.2 Run `pnpm lint`, `pnpm typecheck` and both suites; paste both suite blocks verbatim in the
      delivery comment.
- [x] 4.3 Run the final `rg -n -w "conductor" packages/server/src/tools.ts skills templates
      README.md docs` and list each remaining occurrence with its reason in the delivery comment.
