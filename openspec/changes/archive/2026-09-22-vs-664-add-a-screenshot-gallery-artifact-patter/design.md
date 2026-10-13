## Context

The AC Artifact Kit is one CSS string, `ARTIFACT_KIT_CSS` (`packages/core/src/artifacts/kit.ts:44`),
returned by `weave_artifact_kit` along with `tokens`, `components` and `playbooks` and described in
`openspec/specs/artifact-kit/*`. A served artifact is fetched from
`GET /tickets/:id/artifacts/:key/raw` under `ARTIFACT_CSP`
(`packages/server/src/artifact-csp.ts:7`): `sandbox allow-scripts ...; default-src 'none'; style-src
'self' 'unsafe-inline'; img-src data: 'self'; ...`. There is no `script-src`, so scripts fall back to
`default-src 'none'` and never run. The web viewer frames the raw route with
`sandbox="allow-scripts allow-forms allow-popups allow-downloads"`
(`packages/ui/src/components/ArtifactViewer.tsx:159`) — no `allow-same-origin`, so the frame's origin
is opaque. An artifact body is capped at 2,000,000 characters (`ARTIFACT_MAX_CHARS`,
`packages/server/src/tools.ts:391`).

The kit's current image story is only `img { max-width: 100%; height: auto }` (`kit.ts:224`) plus the
bare `.grid`/`.row`/`.cols` flex helpers. See proposal.md for why; this document covers how.

## Goals / Non-Goals

**Goals:**

- One self-contained HTML document can lay out a large set of related images as a labelled grid whose
  cells open full-viewport, pan by scrolling and zoom, with no JavaScript and no external resource.
- The kit defines the pattern as classes; the skill's playbook shows the exact markup and steers a
  multi-image delivery to it; a committed fixture proves the pattern is built only from the kit.
- Nothing about one or two captures changes, and a document that ignores the new classes renders
  exactly as before.

**Non-Goals:**

- No JavaScript, no `<script>`, no external CSS/JS/CDN, ever — the CSP and the design-tokens spec both
  forbid it, so an interactive gallery is a CSS-state gallery or it is not built.
- No reference to ticket attachment URLs as image sources (see Decision 5).
- No change to the artifact size cap, the validator, the serving routes, the CSP or the viewer.
- No new tool, DB table, migration or route.

## Decisions

### 1. CSS-only state, not JavaScript

Open the viewer with `:target` (a thumbnail links to its own figure), zoom with a hidden checkbox and
a `<label>` toggled by `:checked`, and pan with `overflow: auto` on the viewer. This is not a stylistic
choice: `ARTIFACT_CSP` sets no `script-src`, so the browser refuses every script in a served artifact,
and the kit's own spec (`artifact-kit/design-tokens`) requires no JavaScript. A JS gallery would work
in a hand-opened file and silently do nothing once published — the exact failure this ticket exists to
prevent.

*Alternative rejected:* inline JavaScript in the artifact. It cannot execute under the served CSP.

### 2. The gallery cell promotes itself — one embed per image

A single `<figure class="gallery-figure" id="g-N">` holds the zoom checkbox, the thumbnail link
(`<a class="shot" href="#g-N"><img …></a>`), the caption and the nav links. In the grid it is a cell;
`:target` rewrites it to `position: fixed; inset: 0` and it becomes the viewer. Because the same `<img>`
is the thumbnail and the enlarged view, each image's base64 appears once. That halves the document
against a separate thumb + overlay copy, which matters directly against the 2 MB cap.

*Alternatives rejected:* a separate `.lightbox` element per image duplicates every data URI; a single
shared viewer cannot work without JS (the image source cannot be swapped by CSS).

### 3. Safe centring so a zoomed image is reachable

The viewer is a scroll container with `display: grid` and the image at `margin: auto` rather than
`place-items: center`: `margin: auto` centres a fitting image, but when the image is larger than the
viewport the auto margins resolve to zero and the image sits flush to the start edge, so the top-left
is reachable by scrolling. `place-items: center` clips the overflow start edge and strands it.

### 4. The threshold is four

The existing UI-review pattern is a two-capture before/after pair, and up to three images still scan
inside a `.row` of cards. At **four or more** images that belong together, a flat attachment list
stops being scannable and a zip hides every image behind a download — the ACME-168 case (66 images)
is far past it. The skill states four as the trigger, and leaves one-to-three on the existing pattern.

### 5. Images stay `data:` URIs — attachment URLs are not used

The skill already requires images as `data:` URIs, and it must: the viewer's iframe is sandboxed
without `allow-same-origin`, so its origin is opaque and CSP `img-src 'self'` does not resolve to the
daemon origin — an attachment-URL `<img>` cannot be relied on to load. Inlining also keeps the
artifact meaningful when opened straight from disk. The consequence is the size budget in Decision 6.

### 6. The size reality is documented, not hidden

Base64 inflates bytes ~33% and the body cap is 2 MB, so a self-contained gallery holds a moderate set
of downscaled images. The playbook states this and its remedy: downscale (the gallery is for review,
not archival), and/or split a large set into several gallery artifacts — grouped by the same axis the
delivery already has (per tab, per width, per step). The full-resolution originals remain ticket
attachments; the gallery is the presentation layer.

### 7. The worked example is a committed fixture plus a structural test

"Renders correctly" cannot be measured in jsdom, and the repo's convention is to test the model as a
pure function and verify the rest visually. So: a committed `gallery.fixture.html` built on the kit is
checked structurally — every gallery class it uses is defined in `ARTIFACT_KIT_CSS`, it has no
`<script>` and no non-`data:` URL, its embedded PNGs pass `validateArtifactImageDataUris`, and each
image's bytes appear once — and a real rendered gallery is published to this ticket as visual evidence
before review. A skill test asserts `references/gallery.md` ships and is reachable through
`readArtifactPlaybooks` and the SKILL table.

### 8. The new classes are listed as components; the tool needs no change

`ARTIFACT_KIT_COMPONENTS` gains an entry per new class group so `weave_artifact_kit`'s `components`
field documents it, and `readArtifactPlaybooks` already reads every `references/*.md`, so
`references/gallery.md` reaches agents with no tool or prompt change. No token is added, so the token
drift test is untouched.

## Risks / Trade-offs

- **`:target` changes browser history.** Opening a viewer pushes a fragment and Back closes it — a
  normal, acceptable lightbox behaviour; the close link also clears the target.
- **A very large gallery is still too big for one body.** Mitigated by Decision 6's documented
  downscale/split rule; the cap itself is deliberately unchanged (Non-Goals).
- **A checkbox-driven zoom is less discoverable than a JS control.** Mitigated by a visible, labelled
  control in the kit's button style, and by the playbook's markup being copy-ready.
- **New classes drifting from what the playbook tells agents to write.** Mitigated by Decision 7's
  fixture check: a class in the fixture that the kit does not define fails the test.
- **Existing artifacts changing behaviour.** None can: artifacts are stored bytes, the new rules are
  additive CSS, and a document that does not use the classes matches none of the new selectors.

## Migration Plan

1. Append the gallery CSS and the component entries in `packages/core/src/artifacts/kit.ts`.
2. Add `skills/weave-ai-artifacts/references/gallery.md`; update `SKILL.md`, `skills/README.md` and
   `skills/manifest.json`.
3. Add the fixture and its test; update `docs/PLAN.md` § artifact-kit.
4. No data migration and no feature flag: the change is CSS plus text, inert to previous code, and
   rollback is the previous release. `pnpm daemon upgrade` deploys it; newly published artifacts pick
   up the kit, existing ones are unchanged.
