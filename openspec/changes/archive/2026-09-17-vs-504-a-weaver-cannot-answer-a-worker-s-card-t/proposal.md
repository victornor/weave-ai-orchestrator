## Why

Workers can raise a decision with required inputs, but the weaver-owned `weave_decision_answer` tool cannot submit those values. The underlying decision service and human card already support the inputs, so a worker can be left waiting on a card that its owner cannot answer and the answer audit trail is lost.

## What Changes

- Extend `weave_decision_answer` with the same keyed input-value map accepted by the decision answer service and returned as `answerInputs`.
- Route agent answers through the existing input validation, including required values, declared single-choice keys, and the other input types supported by decision cards.
- Keep the existing ownership and relay rules: weaver-owned cards are answered directly by the weaver, while human-owned ask/concern/gate-finding cards may still be relayed from a human message.
- Add regression coverage for a weaver-owned question with two required single-choice inputs, including the stored and worker-wake `answerInputs` round trip and invalid-value rejection.
- Audit every decision kind answerable by the weaver to ensure input-bearing cards use the same path; document any intentional exception in the implementation tests/spec.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `human-decisions/answer-inputs`: an agent that owns a decision can answer it with the keyed values declared by its inputs, using the same required-field and choice validation as a human card answer.

## Impact

- `packages/server/src/tools.ts` and the agent-facing MCP schema for `weave_decision_answer`.
- `packages/core/src/decisions/service.ts` answer plumbing/types only if needed to expose the existing input contract consistently.
- Core/server decision and MCP tests covering required inputs, invalid choice keys, persisted answers, and worker wake payloads.
