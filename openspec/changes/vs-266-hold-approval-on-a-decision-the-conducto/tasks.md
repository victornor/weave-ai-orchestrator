## 1. Shared: error code and answer-input shape

- [x] 1.1 Add `revision_pending` to `ERROR_CODES` in `packages/shared/src/errors.ts`, mapped to HTTP 409 in `OcError.status`, and verify with a unit test that constructs the error and checks `OcError.status('revision_pending') === 409`.
- [x] 1.2 Extend the decision answer input type (wherever `{ key?, text?, remember?, inputs? }` is currently typed for `decisions.answer`) with optional `overrideHold?: boolean` and `overrideReason?: string`, and verify `pnpm typecheck` is clean.

## 2. Core: the hold and its lift

- [x] 2.1 In `packages/core/src/decisions/service.ts`'s `answer()`, before applying the answer's side effects: if `d.kind` is a `CONDUCTOR_REVIEW_KIND`, `d.status === 'open'`, `d.conductorReviewStatus === 'concerns'`, and the supplied `key` is that kind's approving option (`NAMED_CARD_OPTION_KEYS[kind].approve`), require `ans.overrideHold === true` and a non-empty `ans.overrideReason`; otherwise throw `OcError('revision_pending', ...)` with details naming `conductorReviewNote`/`conductorReviewedAt`. Verify with a unit test: mark an open `plan_approval` `concerns`, answer `approve` with no override, assert the thrown error's code is `revision_pending` and the decision is still `open`.
- [x] 2.2 Verify non-approving answers are never subject to the check: unit test answering `revise` (plan/action) and the non-approving `merge_approval` option on a `concerns`-marked open decision succeeds exactly as before.
- [x] 2.3 Verify the override path: answering the approving key with `overrideHold: true` and a reason succeeds, records a `decision.hold_overridden` activity entry (actor, decision id, reason, timestamp) via `recordActivity`, and posts a system comment on the ticket containing the reason. Verify override with no reason (or `overrideHold` absent) is still refused with `revision_pending`.
- [x] 2.4 Verify supplying `overrideHold`/`overrideReason` on a decision that is not held has no effect: the answer succeeds as normal and no `decision.hold_overridden` activity or comment is written.
- [x] 2.5 Verify the lift-on-supersession flow end to end at the ticket-service level: raise a `plan_approval`, mark it `concerns`, answer `revise`, re-propose the ticket to `proposed` again, and assert the new `plan_approval` decision is `unseen` and its `approve` answers without an override. Repeat for `merge_approval` (mark `concerns` on an open one, request changes, redeliver to `in_review`, assert the fresh decision answers `approve` without an override).
- [x] 2.6 Verify marking the same still-open decision `concerns` a second time (no revision cycle in between) does not lift its own hold: `approve` without an override is still refused.
- [x] 2.7 In `autoMergeSweep` (`packages/core/src/tickets/service.ts`), when `autoApprove` throws `revision_pending`, post the same kind of system comment the CI-red branch already posts (e.g. "auto-merge is waiting: the conductor has concerns"), and leave the ticket `in_review` exactly as the existing catch already does. Verify with a `yolo.test.ts` case: an `in_review` YOLO ticket whose `merge_approval` is open and marked `concerns`, checks green — `autoMergeSweep()` returns without advancing the ticket, the decision stays `open`, and the ticket carries the new comment.

## 3. API and CLI surface

- [x] 3.1 Extend the `POST /decisions/:id/answer` Zod body schema (`packages/server/src/routes/decisions.ts`) with optional `overrideHold`/`overrideReason` and pass them through to `decisions.answer`. Verify with a route-level test posting an answer to a held decision without the override (expect 409 `revision_pending`) and with it (expect success).
- [x] 3.2 Extend `conductor decision answer` (`packages/cli/src/commands/decision.ts`) with an explicit override path — a distinct flag (e.g. `--override-hold <reason>`), not reuse of `--text` — that only takes effect when the CLI's own card model reports the decision is held (see task 4.1/4.2). A plain `conductor decision answer <id> approve` on a held decision prints the `revision_pending` error and its concern note; verify via a CLI-layer test or manual `doctor`-style check against a throwaway daemon (never the real Claude CLI — a decision-answer path needs no runtime at all, so a throwaway daemon with `auth.loopbackTrusted: true` is sufficient and carries no credential risk).

## 4. Shared and render: card copy

- [x] 4.1 Extend `conductorReviewCopy`'s return shape (`packages/shared/src/conductor-review.ts`) with `held: boolean`, true exactly when `tone === 'concerns' && status === 'open'` (reusing the same fields the service already reads), and a line/sentence addition rendered only when `held`. Verify with `conductor-review.test.ts`: an open `concerns` decision reports `held: true` with the new sentence; an answered/superseded/withdrawn/expired `concerns` decision, and a `looked`/`unseen`/`after` decision, all report `held: false`.
- [x] 4.2 Check `packages/render`'s `decisionToCard` (the TUI/CLI card model) for whether it needs the same `held` signal surfaced (per the `NAMED_CARD_OPTION_KEYS`-drift landmine already on file for this function) — thread it through if the CLI's `conductor decision show`/`answer` should render the hold, and verify with a render golden test.

## 5. Web UI

- [x] 5.1 In `packages/ui/src/components/DecisionCard.tsx`, disable the Approve button (plan/action) and "Approve merge" button (merge) when `conductorReviewCopy(decision).held` is true, and render the new held sentence via `ConductorReviewLine`. Verify with a component test asserting the button is disabled and the sentence renders.
- [x] 5.2 Add a distinct "Override & approve" control, shown only when held, that opens a reason field (mirroring the existing `Revise…` disclosure pattern) and on submit answers with `key: <approve key>, overrideHold: true, overrideReason: <text>`. Verify with a component test: submitting without text keeps the control open/disabled; submitting with text calls the answer endpoint with both fields and the card leaves its held state once answered.
- [x] 5.3 Verify no other existing DecisionCard test (e.g. the `queryByRole('radio')`-after-answering assertions on file as a landmine) breaks from the new control; scope any bare role queries with `within(...)` if they do.

## 6. Full verification

- [x] 6.1 `pnpm lint` clean.
- [x] 6.2 `pnpm typecheck` clean.
- [x] 6.3 `pnpm test` — both suites green; report both blocks verbatim with real totals (core/server suite and the `@agent-conductor/ui` suite), per this project's standing rule never to report only one.
