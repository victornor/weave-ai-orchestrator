## 1. `Ticket.summary` field

- [x] 1.1 Add migration `packages/db/src/migrations/00XX_ticket_summary.sql` (`ALTER TABLE tickets ADD COLUMN summary TEXT`) and verify `pnpm --filter @agent-conductor/db test` (migrations test) passes with the new column present on a freshly-migrated db.
- [x] 1.2 Add `summary: string | null` to `Ticket` in `packages/shared/src/types.ts`, and update the four typed Ticket-literal test factories (`packages/render/src/entities.test.ts`, `packages/ui/src/test/factories.ts`, `packages/server/test/fakes.ts`, and any other file `tsc -b` flags as missing the field) so the build stays green.
- [x] 1.3 Add `summary` to `TicketCreateInput` (`packages/core/src/api.ts`) and to `tickets.create()`'s insert (`packages/core/src/tickets/service.ts`), and add it to `update()`'s allow-listed patch keys (`Pick<S.Ticket, ...>` in `api.ts`, the `for (const k of [...])` allow-list in `service.ts`). Verify with a `packages/core/src/tickets/tickets.test.ts` case: creating a ticket with a summary returns it, and patching a ticket's summary afterwards updates it.
- [x] 1.4 Add `summary` (`z.string().max(200).optional()`, or `.nullish()` on the patch schema so it can be cleared) to `CreateSchema` and `PatchSchema` in `packages/server/src/routes/tickets.ts`, and to the `ac_ticket_create` tool's input schema in `packages/server/src/tools.ts`. Verify with a route/tool test that a summary round-trips through `POST /tickets` and `PATCH /tickets/:id`.
- [x] 1.5 Add `--summary <text>` to `conductor ticket create` and `conductor ticket set` in `packages/cli/src/commands/ticket.ts`, following the existing `--title`/`--description` pattern. Verify by reading the command's `--help` output shows the new flag (CLI has no route-level test harness here — match the existing option style).

## 2. `DecisionCard` — provenance tag, summary line, compact density

- [x] 2.1 Add `ticketFiledByConductor?: boolean` prop to `DecisionCardProps`; render a small tag in the card's header row (alongside the existing project/asker meta) reading that the ticket was filed by the conductor, shown only when the prop is `true`. Verify with a `components.test.tsx` case per each of the four scenarios in `specs/human-decisions/option-cards/spec.md`'s "conductor filed the ticket itself" requirement.
- [x] 2.2 Add `ticketSummary?: string | null` prop; when `decision.kind === 'plan_approval'` and the prop is a non-empty string, render it as a single line of plain text (not markdown) directly under the title. Absent or empty renders nothing. Verify with a test covering: summary present, summary absent, and a non-`plan_approval` card with the prop set (must not render it).
- [x] 2.3 Add `compact?: boolean` prop. When `true`, apply the reduced padding/margin/button-footprint classes from `design.md`'s Decisions section (card body padding, header and section margins, action-band button horizontal padding/text size) while keeping every existing field, the 44px thumb action-band height, and all touch targets unchanged in size. When `false`/absent, render exactly as today — verify with a snapshot-style assertion or explicit class assertion that `NeedsYou`'s existing rendering path (no `compact` prop) is byte-for-byte the same as before this change.
- [x] 2.4 Verify the existing `chat.test.tsx` `queryByRole('radio')` assertions (noted in the project knowledge base as a past regression) still pass unchanged — the new tag and summary line must not introduce any radio/radiogroup element.

## 3. Wire `Chat.tsx`

- [x] 3.1 At both `DecisionCard` call sites in `packages/ui/src/routes/Chat.tsx`, compute `ticketFiledByConductor` and `ticketSummary` from the same `tickets.data?.find((t) => t.id === d.ticketId)` lookup already used for `ticketIdentifier`/`projectSlug`, and pass them plus `compact` down. Verify with a `Chat.tsx` route test asserting the tag/summary appear for a conductor-filed ticket with a plan and do not appear for a human-filed one.
- [x] 3.2 Confirm `NeedsYou.tsx` is untouched (no new props passed) and add a test asserting its rendered card carries none of the new density classes, so a future edit that widens scope by mistake fails a test rather than shipping quietly.

## 4. Verification

- [x] 4.1 `pnpm typecheck && pnpm lint && pnpm test` green.
- [x] 4.2 Real-browser check (not only jsdom) at a phone width (390×844) and a wide width, covering a plan-approval card, a merge-approval card, a question card and a concern card — the longest of these must still hold the compaction without clipping or crowding. Capture before/after at both widths and record the result (and the images, if the harness produces them) on the ticket.
