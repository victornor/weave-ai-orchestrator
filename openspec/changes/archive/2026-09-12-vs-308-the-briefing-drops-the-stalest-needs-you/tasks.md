## 1. Snapshot: oldest-first, with the true total

- [x] 1.1 In `packages/core/src/briefing/service.ts`, change the `needsYou` query to `ORDER BY created_at ASC` and add a companion count of all open human-owned decisions (`SELECT COUNT(*) … WHERE workspace_id = ? AND status = 'open' AND owner = 'human'`), returning it on the snapshot as `needsYouTotal`; do not raise `NEEDS_YOU_LIMIT`.
- [x] 1.2 Add `needsYouTotal?: number` to `Briefing` in `packages/shared/src/types.ts` (optional, so existing fixtures and the web snapshot's other fields are unaffected); verify `pnpm typecheck` still builds `@weave-ai/shared`.
- [x] 1.3 Update `packages/core/src/briefing/briefing.test.ts`'s `needsYou` block: with decisions created over time the list is oldest-first; weaver-owned, answered and other-workspace decisions are excluded; and with more than the limit of open decisions the **oldest** is present while the newest is not; assert `needsYouTotal` equals the full open human-owned count, independent of the cap.

## 2. Render: report truncation and show age

- [x] 2.1 In `packages/render/src/types.ts`, add `hidden: number` and `hiddenLine: string | null` to `BriefingSection`; document that `hidden` is the number of items a cap dropped and `hiddenLine` is the rendered statement (`3 more waiting`), null when nothing was hidden.
- [x] 2.2 In `packages/render/src/briefing.ts`, compute `hidden = max(0, (needsYouTotal ?? needsYou.length) - needsYou.length)`, set `hidden`/`hiddenLine` on the `needs-you` section only (a pluralised `N more waiting`), leave the other three sections at `hidden: 0` / `hiddenLine: null`, and render each card's meta age with `formatAge` instead of `formatRelative`.
- [x] 2.3 Update `packages/render/src/briefing.test.ts`: the existing full-snapshot assertion reflects the `formatAge` meta (`2m` not `2m ago`) and `hidden: 0`; add an over-limit case (an older decision present, `hidden > 0`, `hiddenLine` states `N more waiting`); keep/confirm the empty case asserts the section is present with its empty line and no truncation statement.
- [x] 2.4 In `packages/cli/src/commands/conversation.ts`, print `section.hiddenLine` (dim) after a section's items when it is non-null; verify the existing `program.test.ts` briefing output test still passes or update it for the new line.

## 3. The weaver's own rendering contract

- [x] 3.1 In `skills/weave-ai-briefing/SKILL.md`, extend the `### Needs you` block: when the snapshot carries more open decisions than the items listed, the section states how many more are waiting, in the same plain form the CLI line uses (`N more waiting`), rather than presenting the capped list as the whole truth. Keep the edit inside that block.
- [x] 3.2 In `packages/server/src/tools.ts`, extend `weave_briefing`'s description to name the snapshot's total (the count over the capped `needsYou` list); verify `packages/shared/src/tools.test.ts` stays green and `pnpm typecheck` builds `@weave-ai/server`.
- [x] 3.3 Confirm the skill's overflow wording and the CLI's `hiddenLine` use the same plain form, and that both name the snapshot total as the source (not a re-count).

## 4. Verification

- [x] 4.1 Confirm the change is confined to the files above plus their tests — `grep` shows no web-app (`packages/ui`) or server-route consumer of `briefing.needsYou` is touched, and the web Needs-you count/order is unchanged.
- [x] 4.2 `pnpm lint`, `pnpm typecheck`, and both test suites (`vitest run`, then `pnpm --filter @weave-ai/ui exec vitest run`) green; paste both suite blocks verbatim in the delivery report.
