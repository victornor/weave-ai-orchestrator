## 1. Landing presentation

- [x] 1.1 Record `landedOn` and `landedSha` in `ticket.delivery` when `merge_done` verification passes; expose a derived delivery state (`on_landing` | `in_production`) on the ticket API
- [x] 1.2 Merge card title and copy read "Land on {landing}" when the effective landing differs from the default; unchanged otherwise
- [x] 1.3 Confirm and test that a change ticket's PR opens against the landing branch and `merge_done` finishes it; worker prompt forbids retargeting to the default branch
- [x] 1.4 UI: "on {landing}" badge on ticket surfaces and "Land on {landing}" merge card

## 2. Promotion card

- [x] 2.1 Add `promotion_approval` to `DECISION_KINDS`, not to `ASKABLE_DECISION_KINDS`; migration for project-scoped decisions and one-open-per-project
- [x] 2.2 Project `promotionNotes` config and schema
- [x] 2.3 Promotion service: range computation (ahead/behind, commit list, tickets included), fast-forward check, held reasons
- [x] 2.4 Project promotion status endpoint and a request-promotion action/tool that raises the card for the human, weaver-reviewable
- [x] 2.5 Decisions service: human-only approval, reviewed at both heads, YOLO/auto-merge/system refusal
- [x] 2.6 UI: project Promote control, promotion card (tickets, range, notes, held state with no Promote button)

## 3. Daemon promote and aftermath

- [x] 3.1 On approval, guarded fast-forward push under the project landing lock; head-moved and remote-rejected leave the card open with the reason
- [x] 3.2 Record promotion; included tickets derive "in production"; none reopen
- [x] 3.3 Hotfix: ticket landing on the default branch reads "in production"; next card states landing is behind the default

## 4. Copy, specs, verification

- [x] 4.1 Weaver prompts and skills stop suggesting `gh pr merge` for landing-to-default; `tools.test.ts` guard passes
- [x] 4.2 Tests for every scenario in the promotion spec, using temp git repos with a bare remote
- [x] 4.3 `pnpm test` (both suites), typecheck and lint clean; report both suite blocks verbatim
