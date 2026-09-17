## 1. Expose the shared answer-input contract

- [x] 1.1 Extend the `weave_decision_answer` agent-tool schema and handler to accept and forward an optional keyed map of string or string-array values, and update its description to document the input round trip; verify the server package typecheck and tool-schema tests pass.

## 2. Prove owner answers and validation

- [x] 2.1 Add an MCP regression test that creates a weaver-owned question with two required `single_choice` inputs, answers it through `weave_decision_answer`, and asserts the stored `answerInputs` and worker wake payload; verify the answer succeeds.
- [x] 2.2 Extend the regression coverage for a missing required input and an undeclared single-choice key, asserting validation names the input/key and leaves the decision open; verify the existing human-card/core input tests remain green and the generic service path is shared by all decision kinds.

## 3. Validate the change

- [x] 3.1 Run the affected core/server decision and MCP tests plus strict OpenSpec validation, and verify the complete suite blocks pass according to the repository's test command before delivery.
