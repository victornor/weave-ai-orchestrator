## 1. The shared worker live feed

- [x] 1.1 Build `packages/ui/src/v2/WorkerFeed.tsx` exporting a `useWorkerRun(agentId, fallbackRunId)`
  hook that resolves the worker's current run (active from `useRuns({status:'running'|'queued'})`,
  else the newest recent run, else the fallback) and a `<WorkerFeed>` component that streams that run
  through the existing `useRunEventStream` and renders it through `RunTranscript`. Verify with a unit
  test that the hook picks the active run over an older one and falls back to the newest/first run.
- [x] 1.2 Add the compact variant: a `compact` prop that bounds the feed's height and scrolls
  independently, preserving the authored indentation of each trace line. Verify with a component test
  that the compact feed renders the trace rows with their leading indentation preserved and within
  its own scroll container.
- [x] 1.3 Export the feed so Live, Roles and Chat can import it, and state its import path in the
  module doc comment. Verify by importing `WorkerFeed` in the V2 decision card (task 2.5) with no
  V1 import and no duplicate stream hook.

## 2. The V2 decision card

- [x] 2.1 Build `packages/ui/src/v2/DecisionCard.tsx`: the neutral header (`Needs you` /
  `Worker question` text, no status glyph), the ticket identifier, project identity, and the review
  state rendered on cards only via `weaverReviewCopy`. Verify with a test that the header has no
  status glyph, that an `unseen`/`looked`/`concerns` decision renders its line and note, and that a
  non-carrying kind (a `question`) renders none.
- [x] 2.2 Render the body: `Markdown` context, the plan/action document via `documentTarget` and the
  existing document-preview path, and options with the picked/recommended marking. Verify with a test
  that a plan-approval card renders its document and that an option card marks the recommended one.
- [x] 2.3 Render every input kind with VS-342 semantics: `single_choice` (recommended marked and
  pre-selected, optional own-words), `multiselect`, `text`, `multiline`, `secret` (masked, submitted
  under `secretName`), plus the required-input gate that names the first missing input. Verify with
  tests for each input kind's answer payload, including the secret's `secretName` and the empty
  required input keeping the action unavailable.
- [x] 2.4 Render relayed answers as the human's words recorded by the weaver, and inert (answered /
  superseded / withdrawn / expired) cards as records with no actions. Verify with a test that a
  relayed answer shows the relay copy and an answered card offers no answer action.
- [x] 2.5 Make artifacts reachable: when the decision names a ticket, query
  `useTicketWorkProducts(ticketId)` and link the first `type: 'artifact'` product; render no artifact
  affordance when there is none. Verify with a test that a card with an artifact product renders its
  link and a card without one does not.
- [x] 2.6 Build the held state: the weaver's objection (review note) in its own words, the
  `Revision in progress · Nm` row with a pulsing dot and a **Watch** toggle, a disabled Approve with
  `Override…` beside it, and "Approval is blocked until a revision lands.". Verify with a test that a
  held card shows the objection, the revision row, a disabled Approve and the blocked copy.
- [x] 2.7 Wire **Watch** to expand `<WorkerFeed compact>` in place and collapse it, with the
  expanded-or-collapsed state held per card so two cards toggle independently. Verify with a test that
  activating Watch on one of two held cards expands only that card's feed and toggles it back.
- [x] 2.8 Build Override: a reason field that is required (submit disabled while empty), copy stating
  the reason is recorded and the weaver stands down, and "Override and approve" submitting the
  approving option with `overrideHold: true` and `overrideReason`. Verify with a test that the
  override action is unavailable without a reason and that a reason submits
  `{ key: <approve>, overrideHold: true, overrideReason }`.
- [x] 2.9 Add the narrow-pane variant for the chat pane: the same anatomy sized for the pane, plus a
  work-product link and an `Ask the worker` action. Verify with a test that the narrow variant renders
  the work-product link and `Ask the worker`.
- [x] 2.10 Wire answering through `useAnswerDecision` with the shared `decisionSecrets`,
  `decisionStaleness` and queued-answer behaviour, so a card answers exactly as V1 does. Verify with a
  test that an answer calls the answer mutation with the built payload and that a secret-carrying card
  answers directly (never queued).

## 3. The global Needs you screen at `/v2/needs`

- [x] 3.1 Build `packages/ui/src/v2/NeedsYouPage.tsx`: load open human decisions across every
  workspace with `useDecisionsMany`, render each as the V2 decision card, and show an empty state
  when there are none. Verify with a test that decisions from two workspaces render and that an empty
  result shows the empty state.
- [x] 3.2 Add the filter row: scope filters (`Everywhere` then each workspace) leading, decision-kind
  chips after them, both filtering the list for real and combining. Initialise the scope from
  `useV2Scope()` so `/v2/w/:ws/needs` opens on that workspace and `/v2/needs` on Everywhere. Verify
  with tests that a workspace filter shows only that workspace's decisions, a kind chip shows only
  that kind, and the workspace path pre-applies its scope.
- [x] 3.3 Derive the header count and any scope count from the one filtered array the list renders.
  Verify with a test that the header count equals the number of rendered cards and changes with the
  filter.
- [x] 3.4 Replace the `V2NeedsPage` placeholder in `v2/pages.tsx` (both the global and workspace
  addresses) with the real screen; keep `V2ChatPage` as the narrow-variant host only if the chat pane
  layout stays out of scope. Verify that `/v2/needs` and `/v2/w/:ws/needs` render the screen with
  their headers and that VS-343's navigation tests still pass.

## 4. Verification

- [x] 4.1 Run `pnpm lint` and `pnpm typecheck`; both clean.
- [x] 4.2 Run `pnpm test` (core/server suite) and `pnpm --filter @weave-ai/ui exec vitest run`
  separately; paste both suite blocks verbatim in the report and confirm both pass.
- [x] 4.3 Confirm no HTTP route, MCP tool, CLI command, database migration or daemon file changed, and
  that V1 at `/` and its tests are untouched.
- [x] 4.4 Run `openspec validate vs-345-weave-v2-ui-needs-you-the-v2-decision-ca --json --strict` and
  confirm it is clean.
- [x] 4.5 Treat the acceptance list as the exit criteria: real open decisions across workspaces;
  scope and kind filters filter for real; header counts match the list; a held card shows the
  objection, revision row with Watch, disabled Approve and a working reason-required Override; Watch
  expands a per-card live feed; a `single_choice` card renders and answers.
