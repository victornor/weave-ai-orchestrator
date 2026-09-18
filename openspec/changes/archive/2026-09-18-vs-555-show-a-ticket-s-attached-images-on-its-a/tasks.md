## 1. The shared evidence strip

- [x] 1.1 Add a presentational `TicketEvidence` component: image previews, a labelled download row
      per non-image, newest-first ordering with each item's capture time, a full-size overlay opened
      from a preview (portal, click/Escape to dismiss, raw-URL link), and no markup at all when the
      list is empty.
- [x] 1.2 Component tests: several images, an image beside a non-image, the empty case rendering
      nothing, and the full-size overlay opening and dismissing.

## 2. Cards show the evidence

- [x] 2.1 `V2DecisionCard`: enable the ticket-detail query for `plan_approval`, `merge_approval` and
      `action_approval` and render `TicketEvidence` from its attachments; confirm it on Needs you and
      in the chat pane.
- [x] 2.2 V1 `DecisionCard`: render the same strip on its plan/merge approval mounts, so the ticket
      page shows it too; confirm a ticket with no attachments is unchanged there.
- [x] 2.3 Card tests: evidence present, absent (card unchanged, nothing reserved) and mixed
      image/non-image, plus the ticket read still loading or failed.

## 3. Attaching is the easy path

- [x] 3.1 Core ticket `putAttachment`: accept the acting agent's own home (live `workers/<agentId>` or
      archived `archive/workers/<agentId>`) in addition to the existing roots, leaving the shared
      outbound-chat allowlist untouched. Guard the home: compare realpath-resolved candidate against
      the realpath-resolved home, refuse hidden segments (dotfiles/dot-directories) and runtime config
      under the home, and keep the worktree's existing allowance. Tests for own-home accept, another
      agent's home reject, hidden/config reject, outside-every-root reject, and a symlink in the home
      pointing outside it being refused.
- [x] 3.2 Update the `weave_ticket_attachment_put` description and the worker skill to attach rendered
      evidence to the ticket (naming the agent's own home as an accepted capture location); keep the
      agent-prose guard green.

## 4. Verify and deliver

- [x] 4.1 Run `pnpm lint`, `pnpm typecheck` and `pnpm test`; paste both suite blocks verbatim.
- [x] 4.2 Render an approval card with a screenshot and a non-image in light and dark at desktop and
      phone widths, attach the captures to VS-555, and state the revision-scoping decision on the
      ticket.
- [x] 4.3 Deliver the branch per the delivery mode and request review.
