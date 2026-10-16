## Approach

Drive `runTool('weave_ask', ctx, args)` (the same entry as the MCP and HTTP routes) against a real `DecisionService` over a real test DB, not the fake in `packages/server/test/fakes.ts`. Reuse the core decisions test harness where possible. Assertions are on stored values: `inputs[].choices` and, after `decisions.answer`, `answerInputs`.

## Cases

- Two `{key,label}` choices on a `single_choice`, plus a second `single_choice` and a `multiselect` on the same card: created, choices stored, answered into `answerInputs`.
- One `single_choice` choice: rejected with `needs at least two choices` (code `validation`).
