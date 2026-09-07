# Every card says whose project it is, and can ask for more than one key

Change for [VS-92](conductor://tickets/VS-92).

## Why

Two complaints from the same surface, on the same day.

**The card does not say what it is about.** `DecisionCard` already joins a `projectSlug` into its
meta line, but nothing ever passes one: `Decision` has a `ticketId` and no `projectId`, and most of
what the conductor asks with `ac_ask` carries neither. So a workspace with four projects shows four
identical-looking questions and the human has to open the ticket — or guess — to know which
codebase is waiting. A card that concerns no project at all is indistinguishable from a card whose
project simply was not resolved.

**One key or a sentence is the whole answer model.** A decision is answered with `answerKey` or
`answerText` and nothing else, so anything the conductor actually needs — three of these five
regions, a base URL *and* a token, a read-only API key — has to be asked for in prose and pasted
into the chat. That happened today: the conductor asked for a read-only Cloudflare token and the
only place to put it was the conductor thread, where it is now sitting in `thread_messages`, in the
transcript of that turn, and in every future context window that reads the history back.

The store the fix needs is half-built already. `secrets` exists as a table of names, `roleSecretsEnv`
already injects a role's listed secrets into its workers' environment and hands the values to
`makeRedactor` so they are scrubbed from the transcript — but nothing has ever written the table,
there is no way to register a value, and `PLAN.md §21` forbids the obvious shortcut of putting the
value in a column.

## What Changes

- **A decision knows its project.** `decisions.project_id`, set from the ticket when the decision
  concerns one and from the asker's own `projectId` claim otherwise, and overridable by an explicit
  `projectId` on `ac_ask` — so the conductor, which belongs to no project, can still say which one
  a question is about. Existing rows are backfilled from their ticket.
- **Every card carries the label, and a card with no project says so.** The chat (pinned and
  answered), `Needs you` and the ticket page all pass the slug; the card prints `Workspace` when
  there is none, so an unlabelled card can no longer mean two different things. On a merge approval
  the PR link stops displacing the meta line — they sit side by side.
- **`ac_ask` gains `inputs`.** Alongside `options`, a list of `{key, label, type, required?}` where
  `type` is `text`, `multiline`, `multiselect` (with `choices`) or `secret` (with `secretName`).
  The card renders them under the options, blocks its send action until every required one is
  filled, drops empty optional ones, and delivers the rest to the asker as `answerInputs` — a map
  keyed by input key, whose value is a string for the text types and an array of chosen keys for a
  multi-select. A decision with no `inputs` is byte-for-byte the decision it is today.
- **A `secret` input's value never becomes an answer.** Submitting the card registers the value in
  the workspace secret store under the input's `secretName` and records only that name in
  `answerInputs`. The value is not in the decision row, the wake payload, the activity log, the
  chat, the ticket, the run transcript or the export — and a card carrying a secret input is never
  put in the browser's offline queue, because that queue is `localStorage`.
- **The workspace gets a secret store that honours PLAN.md.** `secrets` keeps holding names,
  env-var names and scope, and the values live in `.agent-conductor/secrets.enc` — AES-256-GCM
  under a key in `.agent-conductor/secrets.key`, both `0600`, both under the `.agent-conductor`
  `.gitignore` and outside the export and the database backup. `SecretsService` can register, list
  (names only) and read a value; there is no route, no tool and no event that returns one.
- **A role can be given a registered secret.** `ac_role_set_secrets` puts names on a role's
  `secrets` list after checking each one is registered, and `roleSecretsEnv` falls back to the
  store when `process.env` does not carry the name — so the next worker of that role gets it as an
  environment variable, and `makeRedactor` scrubs it from the transcript exactly as it already
  scrubs the run token.
- **Telegram says the project and sends inputs to the web.** `decisionToCard` prints `Workspace`
  when a decision has no project, and a card with inputs is rendered as a question to answer in the
  web app rather than as a set of buttons that cannot collect a value safely.

## Capabilities

### Modified Capabilities

- `human-decisions/option-cards`: the requirement describing what a card shows is modified so that
  the project is always one of the things it says, named or stated as the workspace. The
  requirement describing how an answer reaches the asker is modified so that the values collected
  on the card travel with it.

### Added Capabilities

- `human-decisions/answer-inputs`: what an asker may ask for beyond a choice — the four input
  types, what a card does with them, what blocks a send, what is dropped, what the asker receives,
  and the rule that a secret input's value is never the answer and never leaves the daemon.
- `workspace-secrets/collected-secrets`: registering a secret value the human supplied, where it is
  held and how it is protected, that nothing can read it back out, attaching one to a role, and
  what a worker of that role receives.

## Impact

- `packages/shared/src/types.ts` — `Decision.projectId`, `Decision.inputs`, `Decision.answerInputs`,
  `DecisionInput`, `DecisionInputChoice`, `DecisionAnswerInputs`, `WorkspaceSecret`.
- `packages/db/src/migrations/0013_decision_project_inputs.sql` — `project_id`, `inputs_json`,
  `answer_inputs_json` on `decisions`, plus the backfill from `tickets`.
- `packages/db/src/rows.ts` — the three new columns on `decisionRow`.
- `packages/core/src/secrets/{index,store}.ts` — the encrypted file store and `SecretsService`.
- `packages/core/src/context.ts` — `secretsFile` and `secretsKey` on `WorkspacePaths`.
- `packages/core/src/decisions/service.ts` — the project on create, input validation on create,
  answer-input validation and the secret hand-off on answer, `answerInputs` in the wake payload.
- `packages/core/src/runs/engine.ts` — `roleSecretsEnv` falls back to the store.
- `packages/core/src/roles/index.ts` — `RolesService.setSecrets`.
- `packages/core/src/api.ts` — `SecretsService`, `DecisionCreateInput.projectId`/`inputs`,
  `DecisionsService.answer`'s input map, `RolesService.setSecrets`, `CoreServices.secrets`.
- `packages/core/src/testing/context.ts`, `packages/server/test/fakes.ts` — the new core service.
- `packages/server/src/routes/decisions.ts` — `inputs` on the answer body.
- `packages/server/src/tools.ts` — `inputs` and `projectId` on `AskSchema`, `ac_role_set_secrets`.
- `packages/shared/src/tools.ts`, `docs/API.md`, `packages/server/src/routetable.ts` — the surfaces.
- `packages/ui/src/components/DecisionCard.tsx` — the project label, the inputs block, the send
  gate; `packages/ui/src/routes/{Chat,NeedsYou,TicketPage}.tsx` — the slug and the no-queue rule.
- `packages/ui/src/api/hooks.ts` — `inputs` on `useAnswerDecision`.
- `packages/render/src/decision.ts` — the `Workspace` subtitle and the answer-in-the-web note.
- Tests: `packages/core/src/{decisions/decisions,secrets/secrets,runs/engine,roles/roles}.test.ts`,
  `packages/db/src/migrations.test.ts`, `packages/server/test/{mcp,decisions}.test.ts`,
  `packages/ui/src/test/{components,needsYou}.test.tsx`, `packages/render/src/decision.test.ts`.

## Out of scope

- Rotating, revoking or expiring a secret, and per-project secret scopes beyond the `scope` and
  `scope_id` columns the table already has.
- Any change to how the existing decision kinds (plan, merge, hire, discard, retry) are answered.
- Collecting a secret from Telegram or the TUI; those cards point at the web app.
- Editing a role's secrets from the web app — `PATCH /roles/:id` already accepts `secrets` and the
  Team view is unchanged.
