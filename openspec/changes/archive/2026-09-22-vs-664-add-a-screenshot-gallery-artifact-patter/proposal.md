## Why

Captain, on VOFM-168 (2026-09-22): a worker reworked a responsive UI across 11 tabs and came back
with 66 before-screenshots plus a metrics JSON, all attached as plain ticket files and a zip, when it
should have laid them out in an openable, pannable, zoomable artifact. The artifact kit
(`weave_artifact_kit`) and the `weave-ai-artifacts` skill exist, but nothing in either offers a way to
lay out many images, so a worker with a large screenshot set defaults to attachments. The delivery is
visual and arrives unscannable.

## What Changes

**Audit — what the kit has today for many images (required output 1):** nothing specific. `.grid`,
`.row` and `.cols` are bare flex helpers (`packages/core/src/artifacts/kit.ts:214`), `card`/`panel`
are generic containers, and the only image rule is `img { max-width: 100%; height: auto }`
(`kit.ts:224`). There is no thumbnail grid, no thumbnail-to-full view, no pan or zoom, and no
multi-image playbook. The gap is a layout component and the guidance to reach for it.

**Add a CSS-only image gallery to the kit.** New semantic classes (`gallery`, `shot`, `gallery-figure`,
`lightbox`, `viewport`, `zoom`, `gallery-nav`, …) so a self-contained artifact can show a labelled grid
of thumbnails where each opens full-viewport, pans and zooms. It uses only CSS state — `:target` to
open a viewer, a `:checked` input for zoom, scroll (`overflow: auto`) to pan — because the artifact CSP
(`ARTIFACT_CSP`, `packages/server/src/artifact-csp.ts:7`) has no `script-src`, so JavaScript can never
run in a served artifact anyway. No external references, no build step, both themes. Each image is
embedded once and the same `<img>` is reused for thumb and viewer, so the data URI is not duplicated.

**Document the pattern (required output 3).** A new playbook `references/gallery.md` with a worked
example and the exact markup; `SKILL.md`'s playbook table and format rules gain the gallery.

**Steer multi-image deliveries to it (required output 4).** `SKILL.md` gains a rule: **4 or more images
that belong together → build one gallery artifact**, with the set grouped and captioned; 1–3 stay on
the existing attachment / two-capture before-after pattern (required output 5). The threshold is
justified in design.md.

**Worked example and test (acceptance 1).** A committed self-contained gallery fixture, exercised by a
test that asserts every class it uses is defined in `ARTIFACT_KIT_CSS`, that the fixture is
self-contained (no `<script>`, no non-`data:` external reference), and that its embedded PNGs pass the
existing `validateArtifactImageDataUris` check. A rendered gallery is also published to this ticket as
visual evidence during apply.

**BREAKING:** none. Existing artifacts are stored bytes; the new classes only affect newly authored
documents, and a document that does not use them renders exactly as before.

**Out of scope / limitations (stated, not guessed):** the artifact body cap is 2,000,000 characters
(`ARTIFACT_MAX_CHARS`, `packages/server/src/tools.ts:391`), and base64 inflates image bytes ~33%. The
gallery is therefore self-contained by design and the playbook documents a downscale-and-group budget
for very large sets (the 66-image case needs downscaled images and/or several galleries). Referencing
the ticket's own attachment URLs instead is deliberately **not** used: the viewer runs in an iframe
sandboxed without `allow-same-origin` (`packages/ui/src/components/ArtifactViewer.tsx:159`), so CSP
`img-src 'self'` does not resolve to the daemon origin and such loads are not reliable; keeping images
inlined also preserves "opens from local disk with no network".

## Capabilities

### New Capabilities
- `artifact-kit/gallery`: a CSS-only image-gallery component the kit ships — a labelled thumbnail grid
  whose cells open into a full-viewport, pannable and zoomable viewer with no JavaScript and no
  external reference — plus the worked fixture that checks it against the kit's CSS.

### Modified Capabilities
- `artifact-kit/skill`: the skill gains a gallery playbook, states the threshold above which a set of
  related images becomes a gallery artifact rather than separate attachments or a zip, and restates
  the no-JavaScript format rule to name the gallery's CSS-only state as the one sanctioned interaction.

## Impact

**Kit / core**
- `packages/core/src/artifacts/kit.ts`: new gallery CSS appended to `ARTIFACT_KIT_CSS`; new entries in
  `ARTIFACT_KIT_COMPONENTS`. No token changes, so the token drift test is untouched.

**Skills**
- `skills/weave-ai-artifacts/references/gallery.md` (new): the playbook and worked markup.
- `skills/weave-ai-artifacts/SKILL.md`: playbook table, format rule, and the multi-image steering rule.
- `skills/README.md` and `skills/manifest.json`: playbook-list description gains the gallery.

**Tests / fixtures**
- `packages/core/src/artifacts/gallery.fixture.html` (new): the worked example, built on the kit.
- `packages/core/src/artifacts/kit.test.ts`: the fixture is self-contained, uses only kit classes, and
  its embedded images validate. A skill test asserts the gallery playbook ships and is listed.

**Docs**
- `docs/PLAN.md` § artifact-kit: the component list and playbook set mention the gallery.

No DB, route, tool-signature or prompt-template change. `weave_artifact_kit` already returns
`components` and `playbooks`, so both new surfaces reach agents with no tool change.
