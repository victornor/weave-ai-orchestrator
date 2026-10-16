## 1. Regression tests

- [x] 1.1 Add a test running `weave_ask` through the real decisions service: a two-choice `single_choice`, a second `single_choice` and a `multiselect` on one card are accepted, choices persist, and answering returns them in `answerInputs`
- [x] 1.2 Add the negative case: a `single_choice` with fewer than two choices is rejected with a `validation` error
- [x] 1.3 Run `pnpm lint`, `pnpm typecheck` and `pnpm test`
