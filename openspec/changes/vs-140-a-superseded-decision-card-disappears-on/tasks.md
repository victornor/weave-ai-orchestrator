## 1. Server: structured detail on a stale answer

- [x] 1.1 In `packages/core/src/decisions/service.ts`, when `answer()` refuses a decision whose
      `status !== 'open'`, attach `details: { status: d.status, supersededBy }` to the `wrong_status`
      `OcError`, where `supersededBy` is the id of the current open decision sharing the stale
      decision's `correlationKey` and `ticketId` (only looked up, and only included, when
      `d.status === 'superseded'`). Verify with a unit test in `decisions.test.ts` asserting the
      thrown error's `details.supersededBy` equals the replacement's id after a supersession, and that
      it is absent for an `answered`/`expired` refusal.
- [x] 1.2 Add a `decisions.test.ts` case: answering the superseded decision with `key: 'approve'` and
      then reading the replacement decision confirms its `status`, `answerKey`, `answeredAt` etc. are
      unchanged by the stale request — the guarantee proposal.md and `approval-integrity`'s new
      requirement both call for.

## 2. Client: close the round-trip window on a known event

- [x] 2.1 In `packages/ui/src/api/events.ts`, for `decision.superseded` / `decision.answered` /
      `decision.expired`, before the existing `inv(...)` calls, patch every cached `qk.decisions(ws)`
      query with `queryClient.setQueriesData`: replace the entry in place when the query's own
      `status` filter (read from the query's key) still includes the event payload's new `status`,
      remove it from that query's array otherwise. Leave `decision.created`/`decision.answered`'s
      existing invalidation of `qk.decision`, `qk.briefing`, `qk.workspaces` as-is.
- [x] 2.2 Add a test in `packages/ui/src/test/events.test.tsx` covering both branches: a
      `decision.superseded` event removes the entry from a `status: 'open'`-only cached query and
      replaces it (with the new status) in a cached `status: ['open','answered']` query — without
      waiting for the query to actually refetch.

## 3. Client: reconcile the decisions list whenever the connection recovers

- [x] 3.1 In `packages/ui/src/api/events.ts`'s `EventStream`, track whether an earlier `onopen` has
      already completed this session; on every `onopen` after the first, invalidate `qk.decisions(ws)`
      in addition to the existing status update. The very first `onopen` of a session does not trigger
      this (the mounted query's own initial fetch already covers it).
- [x] 3.2 Add a test exercising `EventStream`: simulate a drop (`onerror`) and a subsequent successful
      reconnect (`onopen`) and assert `qk.decisions(ws)` is invalidated on the reconnect but not on the
      stream's first open.

## 4. Client: human-terms messaging for a stale answer

- [x] 4.1 Add a small helper (e.g. `packages/ui/src/lib/decisionStaleness.ts` or alongside
      `decisionSecrets.ts`) that turns an `ApiError` with `code === 'wrong_status'` into
      `{ title, detail, ticketId? }` copy: superseded → "This plan changed while you were looking at
      it." with the ticket id from the answered decision (for the "view it" action) when
      `details.supersededBy` is present; answered → "Someone already answered this."; expired →
      "This expired before your answer reached the daemon." Fall back to the raw message for any other
      `wrong_status` shape.
- [x] 4.2 Wire that helper into `Chat.tsx`'s `answerDecision` and `NeedsYou.tsx`'s `onAnswer` error
      handling in place of showing `e.message` directly, when the error is a stale-decision refusal.
- [x] 4.3 Extend `Toast` (`packages/ui/src/components/Toast.tsx`) with an `action: { label: string;
      run: () => void }` field rendered the same way `undo` is (a button that runs and dismisses);
      leave `undo` and its one call site in `Settings.tsx` unchanged.
- [x] 4.4 When the stale-answer toast carries a ticket id, give it an `action` labelled "View the new
      one" that calls `go('/w/$ws/tickets/$ticketId', { params: { ws, ticketId } })`.
- [x] 4.5 Add tests in `chat.test.tsx` and `needsyou.test.tsx`: answering a decision that the server
      refuses with a superseded `wrong_status` shows the human-terms message and an action that
      navigates to the ticket; an answered/expired refusal shows its own copy with no action.

## 5. Verification

- [x] 5.1 `pnpm lint && pnpm typecheck && pnpm test` green.
- [x] 5.2 `openspec validate vs-140-a-superseded-decision-card-disappears-on --json --strict` clean.
