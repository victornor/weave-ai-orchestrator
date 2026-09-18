## Context

Twelve unrelated incidents share one ticket by captain's instruction. The incident bodies are not readable from the worker, so each item starts from the ticket's one-line description plus the code, and reproduction is by test.

## Decisions

- **Triage first, per item, in a fixed order** (1 to 12). Each item gets one commit: a failing test, then the fix, or a note in the report if nothing fails. This keeps a 45-minute turn cut-off from losing more than one item.
- **Reproduce by test, not by live run.** No real coding CLI is launched (credential rotation risk). Codex/Claude items use a fake CLI binary and a scratch config directory.
- **Item 1** touches only `weaver_artifacts` (FK on `workspaces(id)`); the test drives `weaverArtifacts.put` through the tool handler with a weaver context, including the artifact-published subscribers, to find which insert violates the constraint.
- **Item 3** looks already handled (`inputs` accepted by `weave_decision_answer`); the test answers a worker card with required inputs and asserts the recorded `answerInputs`. If it passes, the item is reported already fixed.
- **Item 2** asserts the argv the Codex adapter produces for new, resumed and forked auto turns contains `approval_policy="on-request"`; the "verify live" part is reported unverified.
- **Items 5 and 8** share a cause family (upgrade outcome and wake vs. running sha); they are checked together against the upgrade state machine.
- **Items 9 and 10** are UI; tests cover the model as pure functions (per project convention), not jsdom geometry.
- Items that turn out obsolete are closed, not "fixed for the sake of it".

## Risks

- Scope is large for one change; an item that grows beyond a small fix is split into a named follow-up ticket via `weave_ask` rather than expanded here.
- Incident text is unavailable; a misread item is reported as unreproduced rather than guessed at.
