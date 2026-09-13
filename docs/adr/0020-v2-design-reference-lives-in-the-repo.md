# ADR 0020 — The V2 design reference lives in the repository

**Status:** accepted · 2026-09-13 · narrows the VS-91 keep-out; the rest of `docs/design/` stays
untracked

## Context

VS-91 moved the web app's visual contract out of the repository — `docs/design/` and
`docs/research/` were gitignored, and the contract, prompts and mockup exports were relocated to
the knowledge base because the repository is going public. The rule carried into the working
agreement: `CLAUDE.md` says the visual contract "is held outside this repository and is not
published."

Captain has since finished a full redesign of the web app and wants it built as V2 at `/v2` on the
same daemon. Every later V2 screen ticket needs to read the redesign's own files — the shell, the
screens, the change list and the token set — and those files are not in the repository. The ticket
requires the reference be committed at `docs/design/v2/` so later tickets read it from the repo
rather than from a person's Downloads folder.

## Decision

`docs/design/v2/` is tracked. The ignore rule becomes `docs/design/*` with `!docs/design/v2/` (the
parent directory must not itself be excluded for a negation inside it to apply). The committed set
is the design artifact only: `HANDOFF.md`, `Weave.dc.html`, `Screens.dc.html`, `support.js`,
`assets/`, `shots/` and the three `uploads/*.md`. The ~9 MB of `uploads/pasted-*.png` and
`download.png` session screenshots, `uploads/index.css` and the zip's `.thumbnail` are left out.

This is the single exception to VS-91. `docs/research/` and every other path under `docs/design/`
stay ignored, and the knowledge-base copies of the V1 design material are unchanged.

## Why not

- **Keep the reference out and copy it in per ticket.** Per-ticket copying is how the redesign
  drifts: each screen ticket would read a different export, and nothing in the repository would
  record the version the V2 build was held to.
- **Put it in the knowledge base instead.** The knowledge base is an agent's briefing, not a build
  input: later tickets and the UI-screenshot harness need the real files (`Screens.dc.html`,
  `assets/weave-mark.png`) on disk, and this ticket's acceptance is that the reference is readable
  from the repo.
- **Un-ignore all of `docs/design/`.** The rest of that directory is the superseded V1 contract and
  the earlier prompts, which VS-91 removed for a reason; only the V2 path is wanted.
