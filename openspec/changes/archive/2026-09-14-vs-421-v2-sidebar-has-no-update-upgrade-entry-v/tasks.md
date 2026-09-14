# Tasks

- [x] 1. Add one glyph for the update entry: `update` to `V2GlyphName` (`packages/ui/src/v2/nav.ts`) and map it to Lucide `CircleArrowUp` in `packages/ui/src/v2/Glyph.tsx`; extend `v2icons.test.tsx`'s expected map so the exhaustive check still passes.
- [x] 2. In `packages/ui/src/v2/V2Shell.tsx`, read `useDaemonUpdate()` and `useDaemonUpgrade()` and derive `updateEntry(daemonUpdate.data, daemonUpgrade.data?.upgrade ?? null)` — the same `lib/upgrade` helpers V1 uses.
- [x] 3. Render the entry in the expanded rail above the Everywhere group: a state dot (merging while upgrading, needs-you while available), the title, the detail line and "Open Updates", an accessible name from `updateEntryLabel`, linking to `/v2/settings?section=updates`. Nothing when the daemon is up to date.
- [x] 4. Render the compact form in the collapsed rail (top of the rail, under the mark): the `update` glyph plus the state dot, same link and accessible name.
- [x] 5. Carry the same entry in the More sheet so a phone reaches it; keep the phone tab bar's More button.
- [x] 6. Remove the desktop `<aside>`'s `More…` row and its now-dead button; confirm every destination the More sheet lists is reachable from the desktop rail or its footer, and list the verification in the report.
- [x] 7. Tests in `packages/ui/src/test/v2shell.test.tsx`: update entry renders for available and upgrading, and nothing for up to date; the collapsed rail carries the compact mark; the More sheet carries the entry; the desktop rail has no More row; the phone tab bar keeps More. Update the two existing tests that click the desktop `More…` to open the sheet via the phone tab bar.
- [x] 8. Evidence and checks: screenshots of the V2 sidebar with an update available, while upgrading and up to date in dark and light, plus the collapsed rail with an update available and the phone tab bar with More; `pnpm lint`, `pnpm typecheck` and both test suites pass.
