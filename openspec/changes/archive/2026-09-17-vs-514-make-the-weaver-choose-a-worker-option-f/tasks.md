## 1. Shared guard and unknown-id message

- [x] 1.1 Add `chooseWorkerModel(ctx, requested)` to `packages/server/src/tools.ts`: returns the requested id (or `null`) when the effective catalog has no configured option; otherwise throws `OcError('validation', message, { options })` when the id is missing/empty, with a message naming each configured option as `- <id>: <description>`; returns the requested id unchanged otherwise. Verify with a unit test that a configured catalog refuses the omission and lists options, and that an empty/unconfigured catalog passes through.
- [x] 1.2 Make `resolveWorkerModelId`'s unknown-id error in `packages/core/src/tickets/service.ts` name the valid option ids. Verify with the existing `tickets.test.ts` cases asserting the message contains the valid ids.

## 2. Apply the guard to the agent-facing tools

- [x] 2.1 Apply the guard in the `weave_ticket_create` handler and update its description to state that `workerModelId` is required when the workspace catalog has a configured option. Verify: `runTool('weave_ticket_create', …)` with no id is refused with a message naming every configured id and description; with a valid id it succeeds and stores the id; with an unknown id it is refused naming the valid ids.
- [x] 2.2 Apply the guard in the `weave_ticket_assign` handler when it attaches a role and the ticket names no worker option, and update its description. Verify: assigning a role without an id to a ticket with none is refused naming the options and leaves the ticket unchanged; with a configured id it succeeds; assigning a ticket that already has an id succeeds without re-passing it; `roleId: null` is unaffected.
- [x] 2.3 Apply the guard in the `weave_session_take_ticket` handler's new-ticket branch and update its description. The existing-ticket branch adopts a ticket already created elsewhere, so its model (or default) was settled at creation and is out of scope, as the spec's scenario states ("creates a new ticket"). Verify: taking a new ticket without an id is refused naming the options; with a configured id it succeeds.

## 3. Prove the paths that keep the default

- [x] 3.1 Add server tests that the system paths keep the default with a configured catalog present: project-description scout, knowledge curation and workspace import create with `workerModelId` null. Verify the ticket rows store null.
- [x] 3.2 Add a test that the human `POST /tickets` path creates with no `workerModelId` and stores null. Verify the HTTP response is 201 and the row's `worker_model_id` is null.
- [x] 3.3 Add a test that a create without an id succeeds and stores null when the catalog is empty, and when it is non-empty but every option is unconfigured. Verify via `runTool('weave_ticket_create', …)`.

## 4. Instructions and docs

- [x] 4.1 Update `skills/weave-ai-weaver/SKILL.md` and `templates/weaver.AGENTS.md.tmpl` so the ticket template requires a `workerModelId` when options exist and no longer says to omit it for the default. Verify the wording no longer tells the weaver to omit it.
- [x] 4.2 Update `docs/PLAN.md` §9.2's `weave_ticket_create` signature/note and the `docs/API.md` note for the HTTP path. Verify the docs distinguish the agent tool (required when a configured option exists) from the HTTP/CLI default.

## 5. Verification

- [x] 5.1 Run `pnpm lint`, `pnpm typecheck`, and `pnpm test`; both the core/server and UI suite blocks pass verbatim, and paste both blocks in the PR. Verify no fixture or snapshot asserts the old "omit to use the default" behavior for the agent tools.
