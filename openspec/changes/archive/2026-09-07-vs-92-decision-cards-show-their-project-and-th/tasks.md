## 1. A decision carries its project

- [x] 1.1 `Decision.projectId` in `packages/shared/src/types.ts`, and `DecisionCreateInput.projectId` in `packages/core/src/api.ts`.
- [x] 1.2 `packages/db/src/migrations/0013_decision_project_inputs.sql`: `ALTER TABLE decisions ADD COLUMN project_id TEXT REFERENCES projects(id)`, backfilled from `tickets` for every row with a ticket; the new column mapped in `packages/db/src/rows.ts`.
- [x] 1.3 `create()` in `packages/core/src/decisions/service.ts` resolves the project in order — the ticket's project, else the validated `input.projectId`, else the asker's own project — and refuses a `projectId` that is not a project of this workspace.
- [x] 1.4 `projectId` on `AskSchema` in `packages/server/src/tools.ts`, defaulting to `ctx.claims.projectId`, with the description saying the ticket's project wins.
- [x] 1.5 `packages/core/src/decisions/decisions.test.ts`: the ticket's project wins over a supplied one, a workspace decision takes the asker's project, an unknown `projectId` is refused, and a decision with neither is null; `packages/db/src/migrations.test.ts` covers the backfill.

## 2. Every card says which project

- [x] 2.1 `DecisionCard` in `packages/ui/src/components/DecisionCard.tsx` renders `projectSlug ?? 'Workspace'` in the meta line, and shows the PR link alongside the meta line rather than in its place.
- [x] 2.2 `packages/ui/src/routes/{Chat,NeedsYou,TicketPage}.tsx` pass the slug, resolved from the projects list against `decision.projectId`.
- [x] 2.3 `decisionToCard` in `packages/render/src/decision.ts` subtitles a decision with no project as `Workspace`.
- [x] 2.4 `packages/ui/src/test/components.test.tsx` and `packages/render/src/decision.test.ts`: the named project, the `Workspace` fallback, and a merge approval showing both the PR link and the label.

## 3. Inputs on a decision

- [x] 3.1 `DecisionInput`, `DecisionInputChoice`, `DecisionAnswerInputs`, `Decision.inputs` and `Decision.answerInputs` in `packages/shared/src/types.ts`.
- [x] 3.2 `inputs_json` and `answer_inputs_json` on `decisions` in migration 0013, and both in `decisionRow`.
- [x] 3.3 Create-time validation in `packages/core/src/decisions/service.ts`: unique non-empty keys, a `multiselect` with at least one uniquely-keyed choice, a `secret` with a `secretName` matching `^[A-Z][A-Z0-9_]{0,63}$`; anything else is an `OcError` before the row exists.
- [x] 3.4 Answer-time validation in the same file: unknown keys refused, required inputs must be non-empty, multi-select values must be a subset of the choices in the offered order, empty optional values dropped, and any values at all refused for a decision with no inputs.
- [x] 3.5 `answerInputs` written on the decision row and carried in the `decision_answered` wake payload beside `answer`.
- [x] 3.6 `inputs` on `AskSchema` and `answerInputs` documented in the `ac_ask` description (`packages/server/src/tools.ts`); `inputs` on the answer body in `packages/server/src/routes/decisions.ts` and on `DecisionsService.answer` in `packages/core/src/api.ts`; `docs/API.md` and `packages/server/src/routetable.ts` updated.
- [x] 3.7 `packages/core/src/decisions/decisions.test.ts` and `packages/server/test/mcp.test.ts`: each input type through create and answer, every refusal above, the wake payload, and a decision with no inputs answering exactly as before.

## 4. The secret store

- [x] 4.1 `secretsFile` and `secretsKey` on `WorkspacePaths` in `packages/core/src/context.ts` (`.agent-conductor/secrets.enc`, `.agent-conductor/secrets.key`).
- [x] 4.2 `packages/core/src/secrets/store.ts`: AES-256-GCM read/write of `name → {iv, tag, body}`, the key created on first write, both files `chmod 0600` after writing, a missing or unreadable store treated as empty.
- [x] 4.3 `packages/core/src/secrets/index.ts`: `SecretsService` with `put` (upsert into the `secrets` table and the file, name or explicit env var name validated as an environment variable name), `list` returning `{name, envVarName, scope, hasValue}`, and `value(name)` for the daemon only; `WorkspaceSecret` in `packages/shared/src/types.ts`; the interface in `packages/core/src/api.ts` and the member on `CoreServices`.
- [x] 4.4 The new service supplied in `packages/core/src/testing/context.ts` and `packages/server/test/fakes.ts`, so the proxies do not throw for unrelated suites.
- [x] 4.5 `packages/core/src/secrets/secrets.test.ts`: a value round-trips, a re-registration replaces it, the value is in no table of the database, both files are `0600`, an unusable name is refused, and `list` never carries a value.

## 5. A secret input's value goes to the store, never to the answer

- [x] 5.1 `answer()` in `packages/core/src/decisions/service.ts` registers every secret input's value through `SecretsService.put` *before* the answer transaction, records only the secret's name as that input's value, and refuses the answer — leaving the decision open — when a registration fails.
- [x] 5.2 `packages/core/src/decisions/decisions.test.ts`: the value reaches the store, the recorded `answerInputs` and the wake payload carry only the name, the value is absent from every decision, comment, activity and event row, and a failing store leaves the decision open with nothing recorded.

## 6. Collecting the inputs on the card

- [x] 6.1 The inputs block in `packages/ui/src/components/DecisionCard.tsx`: one control per input in the asker's order — a line, a textarea, a multi-select of the choices, and a masked field for a secret — plus the send gate that names the required input still missing.
- [x] 6.2 An answered card renders the recorded values as a record, a secret shown as the name it was stored under.
- [x] 6.3 `inputs` on `useAnswerDecision` in `packages/ui/src/api/hooks.ts`; `packages/ui/src/routes/NeedsYou.tsx` sends a card carrying a secret input directly and never enqueues it, telling the human it was not sent when the send fails.
- [x] 6.4 `packages/ui/src/test/components.test.tsx` and `packages/ui/src/test/needsYou.test.tsx`: each control renders and collects, the send is blocked until the required input is filled, an empty optional input is omitted from the submitted map, a secret input is masked and never rendered back, and a failed answer for a card with a secret leaves the queue empty.
- [x] 6.5 `decisionToCard` in `packages/render/src/decision.ts` renders a decision carrying inputs as a question to answer in the web app, and leaves a decision without inputs exactly as it is; covered in `packages/render/src/decision.test.ts`.

## 7. A role's secrets reach its workers

- [x] 7.1 `RolesService.setSecrets(actor, id, names)` in `packages/core/src/roles/index.ts` and `packages/core/src/api.ts`: refuse the whole list when any name is unregistered, otherwise replace the role's `secrets`.
- [x] 7.2 `ac_role_set_secrets` in `packages/server/src/tools.ts` (conductor scope) and its name in `packages/shared/src/tools.ts`.
- [x] 7.3 `roleSecretsEnv` in `packages/core/src/runs/engine.ts` falls back to `SecretsService.value(name)` when `process.env` does not carry the variable, and still omits a secret with no value anywhere.
- [x] 7.4 `packages/core/src/roles/roles.test.ts`: setting, refusing an unregistered name in full, and replacement; `packages/core/src/runs/engine.test.ts`: a store-only secret reaches the worker's environment, the daemon's environment wins when both have it, a valueless secret is absent, and a transcript carrying the value is redacted.

## 8. Green

- [x] 8.1 `pnpm typecheck`, `pnpm lint` and `pnpm test` (both the core run and the ui filter) green, with no real credential in any fixture.
