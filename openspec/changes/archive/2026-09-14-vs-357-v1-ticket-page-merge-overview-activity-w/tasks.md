# Tasks

## 1. Tab set and resolver

- [x] 1.1 In `packages/ui/src/routes/TicketPage.tsx`, reduce `TABS` to `overview`, `plan` and
      `artifacts` (Artifacts still filtered out when the ticket has none), and delete the
      `TAB_KEYS` membership test.
- [x] 1.2 Add a resolver that returns `plan` for `?tab=plan`, `artifacts` for `?tab=artifacts`, and
      Overview otherwise, plus a companion that maps the old values `activity`, `work`, `usage` and
      `knowledge` to the section each named. Keep `?tab=` mirrored into state on load and on change.
- [x] 1.3 Render only `overview`, `plan` and `artifacts` content; remove the `activity`, `work`,
      `usage` and `knowledge` content branches.

## 2. The four-row Overview tab

- [x] 2.1 Rename `Overview` → `OverviewSection`, `ActivityTab` → `ActivitySection`, `WorkTab` →
      `WorkSection`, `UsageTab` → `UsageSection`, `KnowledgeUsageTab` → `KnowledgeSection`, and drop
      each one's own `mx-auto max-w-3xl` wrapper. Leave Plan and Artifacts untouched.
- [x] 2.2 Add `OverviewTab` composing one `mx-auto max-w-5xl` scrolling column: row 1 a
      `lg:grid-cols-2` split with `OverviewSection` left and `ActivitySection` right (overview first
      in DOM, so it stacks first), the activity pane given `lg:max-h-[70vh] lg:overflow-y-auto`; rows
      2-4 `WorkSection`, `UsageSection`, `KnowledgeSection` with headings.
- [x] 2.3 Give the five rows the ids `ticket-section-overview`, `ticket-section-activity`,
      `ticket-section-work`, `ticket-section-usage` and `ticket-section-knowledge` in that DOM order.
- [x] 2.4 In `OverviewTab`, an effect on mount scrolls `#ticket-section-<section>` into view when the
      URL carried an old tab value, guarded so a missing element or an absent `scrollIntoView` is a
      no-op.

## 3. Audit the links that open a ticket on an old tab

- [x] 3.1 Search the UI for ticket links carrying a tab value. Confirm the only old-value links are
      the two in `project/PullRequestsSection.tsx` and the merge card's in `components/DecisionCard.tsx`
      (`tab=activity`), and that `project/KnowledgeSection.tsx` / `lib/map/model.ts` target the
      `/w/$ws/knowledge` route rather than a ticket. No link needs rewriting: the alias resolves them.
      Record the audit in the PR.

## 4. Tests

- [x] 4.1 Update `packages/ui/src/test/ticketpage.test.tsx`: stop clicking the removed Activity and
      Knowledge tabs; assert the tab set (Overview, Plan only without an artifact; plus Artifacts with
      one), the four-row section order, and the old-tab mapping for `activity`/`work`/`usage`/`knowledge`
      to a selected Overview (and the unknown-value fallback).
- [x] 4.2 Keep the existing live-input assertions (composer send, steer label, retired/paused
      composer, merge-approval answering) working against the merged default Overview.
- [x] 4.3 Update `packages/ui/src/test/liveTranscript.test.tsx`: the running turn's stream now opens
      on the default Overview; remove the "Activity tab" click and the stale comment, keeping the
      one-stream, collapse-on-finish and expand-on-demand assertions.
- [x] 4.4 Confirm `packages/ui/src/test/pullRequests.test.tsx`'s `tab: 'activity'` link assertion still
      holds and reads as the alias it now is.

## 5. Verify and report

- [x] 5.1 Run `pnpm lint`, `pnpm typecheck`, and both test suites; paste both suite blocks verbatim in
      the PR.
