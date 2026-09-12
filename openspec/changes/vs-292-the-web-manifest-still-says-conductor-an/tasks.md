# Tasks

## 1. Correct the manifest

- [x] 1.1 Set `"short_name"` to `"Weave"` in `packages/ui/public/manifest.webmanifest`.
- [x] 1.2 Check whether anything in the app assumes a portrait viewport (code, CSS, `screen.orientation`, `matchMedia`), remove the `"orientation"` key if nothing does, and record the finding in the report. Finding: nothing does — only `aria-orientation` on two accessible controls and the `orientationchange` re-measure in `packages/ui/src/lib/viewport.ts`, which anticipates both orientations; no `screen.orientation` lock and no `matchMedia('(orientation: …)')` anywhere.

## 2. Verify

- [x] 2.1 Confirm the manifest parses as valid JSON, still has the installability-carrying fields (`name`, `short_name`, icons, `start_url`, `display`), and that the icons and service worker are untouched. Confirmed: `JSON.parse` succeeds, `name`/`short_name`/`start_url`/`display`/`icons` all present, and `git status` lists only the manifest and the new change folder.
- [x] 2.2 Run `pnpm lint` and `pnpm test`, pasting both suite blocks verbatim in the report. Result: `pnpm lint` green; core/server suite green (174 passed | 1 skipped, 2622 passed | 1 skipped); UI suite red on two `dictation.test.tsx` (VS-282) failures that reproduce on base `93c277ae` with this branch's changes absent, so they pre-date and are unrelated to this change. Reported, not fixed (out of scope).
