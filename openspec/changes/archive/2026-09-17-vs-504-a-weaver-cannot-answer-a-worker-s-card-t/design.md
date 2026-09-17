## Context

The existing decision service already accepts `DecisionAnswerInputs`, validates them against the decision's declared inputs, settles secrets before recording, stores `answerInputs`, and includes the map in the wake sent to the asker. Human-facing cards use that service path. The weaver MCP tool omits `inputs` from its Zod schema and does not forward them, so required input-bearing cards cannot be answered through the tool.

## Goals / Non-Goals

**Goals:**

- Make the weaver answer tool accept the shared keyed value shape (`string | string[]`) used by `DecisionAnswerInputs`.
- Forward values without duplicating validation, preserving the service's required-field, choice-order, secret, and no-input rules.
- Prove the MCP boundary and the stored/woken answer behavior for a weaver-owned card, including failure cases.

**Non-Goals:**

- Changing decision ownership, relay behavior, card rendering, or the answer-input data model.
- Making required inputs optional or allowing undeclared values.
- Adding input collection to chat, CLI, or other surfaces that cannot safely collect the values.

## Decisions

### Use the existing service contract as the single validator

Add an optional `inputs` object to the `weave_decision_answer` schema, with string values or arrays of strings, and pass it unchanged to `decisions.answer`. The service already validates required inputs, unknown keys, single-choice keys, multi-select keys, optional omissions, and secret registration for every decision kind. Duplicating that logic at the tool boundary would let the human and agent paths drift and would risk exposing secret values.

The alternative is to add a second tool-specific validator or to make the tool call an HTTP/card path. The former duplicates behavior; the latter adds an unnecessary surface hop. The shared service call is the existing convergence point.

### Keep relay and ownership gates unchanged

The tool continues to require direct answers for weaver-owned decisions and continues to accept only prose relays for eligible human-owned ask/concern/gate-finding decisions. `inputs` is forwarded only for the direct owner path; relay answers retain their existing human-message provenance and restrictions. This keeps input values from being mistaken for a human's verbatim message and does not broaden which approval cards the weaver may answer.

### Test the MCP boundary and the generic service audit separately

Add a server MCP test that creates a weaver-owned question with two required single-choice inputs, answers it through `weave_decision_answer`, and asserts persisted `answerInputs` and the worker wake payload. The same test (or adjacent cases) exercises a missing required value and an invalid choice key, asserting the card remains open. Existing core tests already cover the generic validator and all input types; review confirms it is not conditional on decision kind, so no per-kind implementation branch is needed.

## Risks / Trade-offs

- [Risk] A malformed agent-supplied array could reach the service with mixed or non-string values if the boundary schema is too broad → constrain the MCP field to strings or arrays of strings before forwarding it.
- [Risk] A future input type may require a different wire shape → keep the shared `DecisionAnswerInputs` type and service validator authoritative, and add a boundary test when a new type is introduced.
- [Risk] Secret values could appear in logs or wake payloads → preserve the existing service ordering that registers secrets and replaces them with their names before persistence or wake delivery; the tool must not log or transform the map.

## Migration Plan

No data migration is required. Deploying the tool schema change is backward-compatible for callers that omit `inputs`; rollback is a code rollback, leaving existing cards and stored answers unchanged.
