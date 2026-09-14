# Tasks

- [x] 1. Add `lucide-react` to `packages/ui/package.json` (dependency) and the lockfile, with only the icons in use imported by name.
- [x] 2. In `packages/ui/src/v2/nav.ts` delete `V2_GLYPH_STYLE` (and the now-unused `CSSProperties` import), keeping `V2GlyphName` as the destination vocabulary and adding `more`. In `packages/ui/src/v2/Glyph.tsx` map every name to its Lucide component and render a fixed-size, fixed-stroke `<svg>` in `currentColor` carrying `aria-hidden` and `data-v2-glyph={name}` — no styled `<span>` left.
- [x] 3. In `packages/ui/src/v2/V2Shell.tsx`, give the phone "More" tab the `more` glyph (Ellipsis) instead of `settings`, and confirm the expanded rail, collapsed rail, phone tab bar and More list all render `V2Glyph` for every destination with no leftover hand-drawn mark.
- [x] 4. Test `packages/ui/src/test/v2icons.test.tsx`: every destination in `V2_EVERYWHERE`/`V2_WORKSPACE`/`V2_KEPT` renders an SVG whose Lucide class matches the expected map, and no `[data-v2-glyph]` renders without an SVG. Add a shell assertion that the expanded rail, collapsed rail and phone tab bar each carry a mapped icon per row.
- [x] 5. Evidence and checks: before/after screenshots of the expanded rail, the collapsed rail and the phone tab bar in dark and light, plus a 2x-zoom crop; report the UI bundle-size delta; `pnpm lint`, `pnpm typecheck` and both test suites pass.
