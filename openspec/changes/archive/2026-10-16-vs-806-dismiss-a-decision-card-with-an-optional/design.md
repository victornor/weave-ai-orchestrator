## Context

`decisions.withdraw` already exists (route, CLI, service) but is an operator/system cleanup: it takes
a reason, sets `withdrawn`, and wakes nobody. The V2 card has no withdraw control. A weaver-raised
card that is misplaced therefore either gets a made-up answer or lingers.

## Decisions

1. **Reuse `withdrawn`, no new status or migration.** A dismissal is `withdrawn` with
   `answeredByKind='human'`, `answeredById`, `answeredAt` and `answerText=reason`. System withdrawals
   leave those null, so the two are distinguishable without touching the status enum, the DB, or the
   UI's closed-state handling (`decisionStaleness`, inert card).
2. **New `decisions.dismiss(actor, id, reason?)`, not a flag on `withdraw`.** It enforces what
   `withdraw` deliberately does not: human actor only, askable kinds only (read from
   `ASKABLE_DECISION_KINDS`, as relayed answers do), open status. `withdraw` is unchanged.
3. **Scope: askable kinds only.** Those are the cards an agent raised and can usefully re-raise.
   System approvals gate tickets and agents; dismissing one would strand the ticket, and the existing
   reject/revise answers already cover "no". Widening later is a one-line change to the guard.
4. **Wake: `decision_answered` with `dismissed: true`, no `answer`.** It already steers (interrupts a
   running turn), resolves a `blocked` ticket, and reaches `weave_inbox`'s decisions bucket, so a
   worker blocked on its own question resumes too. A new wake source would need engine, enum and
   resolver changes for nothing. The prompt builder renders it from the wake payload (the row is
   `withdrawn`, so the existing `status='answered'` query does not list it) as
   `dismissed — not answered; reason: "…"` with guidance to re-raise or drop.
5. **Reason is optional and trimmed**; none given is stored as an empty string and rendered as "no reason given".
6. **UI**: a `Dismiss…` secondary action in the existing action row, an inline reason textarea (same
   pattern as Revise/Override), posting through a new `useDismissDecision` mutation that removes the
   card from open lists like `useAnswerDecision`. Offline queueing is not added: a dismissal that
   fails with a network error surfaces the error.

## Risks

- A dismissed question a worker was blocked on resumes that worker; its prompt line must say the card
  was not answered so it does not treat silence as consent. Covered by the prompt wording and a test.
