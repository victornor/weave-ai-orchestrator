# VS-491 — picking a roadmap block from the composer's project tag

Rendered evidence from a real Chromium page mounting the **real** `ChatComposer` from
`packages/ui/src` with the package's own `index.css`, in dark and light, at desktop and phone width.
The feature is entirely the composer's project-tag surface, so the harness renders the component
directly with controlled props rather than the whole app: a `web` project tagged, and either its
open blocks offered with `UI polish` chosen, or no blocks at all.

## How they were made

Throwaway harness in `/tmp/vs491` (not committed): a Vite dev server (the worktree's own Vite and
`@tailwindcss/vite`/`index.css`) with a page that reads `?blocks=1|0` and `?theme=dark|light` and
mounts the real `ChatComposer`. Headless Chromium (`/usr/bin/chromium`) captured each URL with
`--screenshot`, `--virtual-time-budget=4000`, window sizes 1000×700 (desktop) and 390×844 (phone).
Nothing reached a live daemon; the composer's `onSubmit` is a no-op.

## What each capture shows

| File | Shows |
|---|---|
| `vs491-blocks-{dark,light}-{desktop,phone}.png` | the `web` project tagged, its block strip below the project strip: **Any block**, then `UI polish` (the active choice, filled), `Docs cleanup`, `Keyboard shortcuts` |
| `vs491-noblocks-{dark,light}-{desktop,phone}.png` | the same tagged project with no open blocks: no block strip at all, the composer exactly as it is today |

Every capture was opened and checked: the block strip appears only in the `blocks` scenes, the
project row and input are unchanged between the two scenes, the active block is filled and the
others are not, the phone width scrolls the strip horizontally rather than wrapping it, and dark and
light are visibly different palettes.

## Notes

- The harness passes `blocks` already filtered to `reportedStatus === 'open'`, which is what
  `ChatPage` computes from `useRoadmapBlocks`; the offerable-set filtering itself is unit-tested
  (`v2chat.test.tsx`, `v2chatcomposer.test.tsx`).
- The strip's height is fixed and only renders when there is something to offer, so a project with
  no open block does not grow the composer (`vs491-noblocks-*`).
