# VS-665 — the composer's unset block choice reads "No block"

Rendered evidence for the label of the composer's roadmap-block strip when no block is chosen, in
dark and light, at desktop and phone width. The old label was **Any block**, which read as if a
block selection were still pending; the unset state actually means "reference the project only".

## How they were made

Throwaway harness in the worktree (not committed): a Vite dev server (with `@weave-ai/shared`/
`@weave-ai/render` aliased to source, as the package's vitest config does) serving a page that
mounts the **real** `ChatComposer` from `packages/ui/src` with the package's own `index.css`, a
`web` project tagged, its three open blocks offered, and `blockId={null}`. Headless Chromium
(`/usr/bin/chromium --headless=new`), `?theme=dark|light` set on the document element, viewport
1000×700 (desktop) and 390×844 (phone) at 2×. Nothing reached a live daemon; `onSubmit` is a no-op.

## What each capture shows

| File | Shows |
|---|---|
| `vs665-noblock-{dark,light}-{desktop,phone}.png` | the `web` project tagged, the block strip below the project strip: **No block** (the unset choice, filled/active), then `UI polish`, `Docs cleanup`, `Keyboard shortcuts` |

Every capture was checked: the leading option reads **No block** and is the pressed one, no
`Any block` option exists, the three block tags are unfilled, and the phone width scrolls the strip
horizontally rather than wrapping it.

## Behavior unchanged

The payload contract is untouched: the label is copy only. A project-tagged message with
`blockId === null` is still just a project reference, never a roadmap item, until a block is picked.
Covered by `packages/ui/src/test/v2chatcomposer.test.tsx` — the default state asserts **No block**
pressed and no **Any block** present, and sending with the unset choice carries `blockId: null`.