## 1. The kit's gallery component

- [x] 1.1 Append the gallery CSS to `ARTIFACT_KIT_CSS` in `packages/core/src/artifacts/kit.ts` — a
  responsive thumbnail grid, a captioned cell that `:target` promotes to a fixed full-viewport viewer
  (safe-centred image, `overflow: auto` pan), a `:checked` zoom control switching between fit and
  natural size, close and prev/next links, both themes, kit tokens only — and add the new class groups
  to `ARTIFACT_KIT_COMPONENTS`; verify the token drift test still passes and a test asserts each new
  selector is present in the kit CSS
- [x] 1.2 Add the worked example `packages/core/src/artifacts/fixtures/gallery.html`, built only on the
  kit, with a labelled grid of a few captioned images embedded as `data:` URIs and no script; verify it
  opens from disk with no network and renders in both themes
- [x] 1.3 Extend `packages/core/src/artifacts/kit.test.ts` to check the fixture: every gallery class it
  uses is defined in `ARTIFACT_KIT_CSS`, it has no `<script>` and no non-`data:` URL, every embedded
  image passes `validateArtifactImageDataUris`, and each image's bytes appear exactly once; verify the
  test fails when a class is renamed or a second copy of an image is added

## 2. Skill guidance

- [x] 2.1 Add `skills/weave-ai-artifacts/references/gallery.md` — what the shape is for, the threshold,
  the size budget (downscale and/or split), and the exact copy-ready markup with a caption per image;
  verify it reads correctly cold and uses only classes defined in the kit
- [x] 2.2 Update `skills/weave-ai-artifacts/SKILL.md`: add the gallery row to the playbook table, note
  the CSS-only state as the sanctioned gallery interaction under the no-JavaScript rule, and state the
  multi-image steering rule with the threshold of four (one-to-three unchanged); verify the text names
  the playbook and the threshold and keeps the existing two-capture pattern
- [x] 2.3 Update `skills/README.md` and `skills/manifest.json` so the skill description names the
  gallery; verify a test asserts `references/gallery.md` is returned by `readArtifactPlaybooks` and is
  listed in `SKILL.md`'s playbook table

## 3. Docs

- [x] 3.1 Update `docs/PLAN.md` § artifact-kit so the component list and the playbook set mention the
  gallery; verify `pnpm lint` passes and the prose matches the shipped classes and playbook name

## 4. Evidence and full verification

- [x] 4.1 Attach the rendered evidence to this ticket before requesting review — the gallery grid,
  an opened capture and a zoomed capture in both themes at desktop and phone width, plus the
  standalone worked example as a downloadable file
- [x] 4.2 Run `pnpm lint`, `pnpm typecheck`, and `pnpm test` with `--maxWorkers=4`, one full suite at a
  time, and paste both suite blocks verbatim on the ticket
