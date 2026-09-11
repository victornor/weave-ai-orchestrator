## 1. One shared state derivation

- [x] 1.1 In `packages/ui/src/routes/Settings.tsx`, extract the thinking-level state rule into one helper (`effortMode(efforts, stored)` returning `picker | hidden | freetext`) beside `effortsForModel`/`settingAfterModelChange`, and switch both `ModelSettingFields` and the add form in `WorkerOptionsEditor` to call it. No behavior change: the existing "Settings — thinking level next to the model (VS-228)" tests in `packages/ui/src/test/models.test.tsx` pass unchanged.

## 2. The row shows and changes thinking level

- [x] 2.1 `WorkerOptionRow` renders the shared control from the option's own model's reported efforts and stored effort: a picker constrained to the list plus `default (unset)` when non-empty, nothing when the list is empty, free text when efforts are unknown or the model is custom. Changing it patches the option with id and description unchanged. Asserted in `models.test.tsx` for a configured row: current value shown, a new value saved, a no-effort row renders unset, an empty-efforts model shows no control, an unknown model shows free text.
- [x] 2.2 While the option's runtime is unset, `WorkerOptionRow` renders no thinking-level control (no picker, hidden state or free-text box), matching the disabled model select. Asserted with a `runtime: null` option.

## 3. A discarded effort is announced

- [x] 3.1 `WorkerOptionRow` records when a model change clears a stored effort the new model does not list and renders a `role="status"` notice naming the value; the notice clears on the next model change. Asserted in `models.test.tsx`: changing to a model that drops the effort shows the notice and stores no effort; changing to one that keeps it shows no notice.

## 4. Green

- [x] 4.1 `pnpm lint`, `pnpm typecheck`, and `pnpm test` (core suite and UI suite). Paste both suite blocks verbatim, including their real totals, in the ticket comment and the PR — do not add them together or report one suite as both.
