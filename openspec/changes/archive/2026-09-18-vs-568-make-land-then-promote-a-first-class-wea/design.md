## Context

`landingBranchOf(project, ticket)` already resolves a ticket's landing branch (ticket, then project, then
default), and VS-119/VS-122 verify against it. What is missing: the tickets do not visibly finish "on
landing", merge card copy is generic, and promotion has no home. Decisions are ticket-scoped
(`decisions.ticket_id`, unique open correlation per ticket) and merge approvals pass through review-hold
logic in `decisions/service.ts`.

## Decisions

1. **Delivery state is derived, not a new ticket status.** "on {landing}" / "in production" is a badge
   computed from the ticket's recorded landed commit and the project's promoted head, stored in
   `ticket.delivery` (`landedOn`, `landedSha`, `promotedAt`). Ticket statuses stay as they are, so nothing
   reopens and no state machine changes.
2. **Landing commit recorded at merge_done.** Verification already knows which strategy passed; it will also
   record the landing head at that moment. "In production" at promote time means: `landedSha` is an ancestor
   of the promoted default head. Squash and cherry-pick cases still work because the recorded sha is a
   landing-branch commit, not the branch head.
3. **`promotion_approval` is a new decision kind, project-scoped.** Migration relaxes `ticket_id` to allow
   null for this kind and adds `project_id` use. The unique open index is widened with project id so at most
   one is open per project. The kind is excluded from `ASKABLE_DECISION_KINDS`.
4. **Gating reuses the review-hold machinery, with a stricter actor rule.** Approving requires the weaver
   `looked` mark at the current heads (extending the VS-474 head guard to record both landing and default
   heads) and a human actor. The system actor, YOLO and auto-merge paths refuse this kind outright.
5. **Promotion is a guarded fast-forward push from the daemon's clone**, run inside the project's existing
   per-project landing lock so it cannot interleave with a ticket landing. Steps: fetch, confirm default is
   an ancestor of landing, confirm landing head equals the reviewed head, `git push origin <sha>:<default>`
   (no force). Any failure leaves the card open with the reason. Non-fast-forward is detected earlier, at
   card build and re-checked at approval, and the card offers no Promote while it holds.
6. **Go-live notes are project config** (`promotionNotes: string[]`), shown verbatim. Fernwood's four facts
   are set on that project's config by the human or weaver; the daemon carries no Fernwood knowledge.
7. **Hotfix needs no new mechanism.** `ticket.landingBranch = default` at creation already lands there;
   the change is presentation ("in production") and the card's behind-warning.

## Risks / Trade-offs

- A branch-protection rule on the default branch (Fernwood's `main-source-guard`) may restrict who can push.
  The daemon pushes with the project's existing forge credentials; if the guard rejects, the card surfaces
  the remote reason. This cannot be verified without the real remote, so it is called out in the PR.
- Tickets landed before this change have no `landedSha`. They read "on {landing}" by a best-effort content
  check when first viewed, and are left unmarked if that is inconclusive rather than guessed.
- Relaxing `decisions.ticket_id` touches queries that join on it; each such query is audited in tasks.

## Open Questions

None blocking. Go-live notes are per-project config rather than derived, which is the simplest faithful
reading of "the card must name Fernwood facts".
