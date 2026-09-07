## Why

Captain's decision (2026-09-07): "Research docs does not go in public repo," widened
the same day to "Remove design documents from git entirely (gitignore)."

The VS-87 public-eyes audit read every file under `docs/research/` and found that
`firstmate.md` and `paperclip.md` reproduce third-party prompt text and interface
shapes verbatim and criticise those projects by name, and that `synapse.md`,
`openspec.md` and `worktrunk.md` are internal competitor and prior-art analysis.
`docs/design/` is the same category: a paid design tool's export, the briefs written
to produce it, and the transcribed contract. None of it is material this project
should publish, and the repository is being prepared to go public. The content is
still worth keeping — it is the rationale behind large parts of the design and the
UI — so the prose moves out of the repository rather than being deleted.

## What Changes

- **Eight knowledge documents** in the `agent-conductor` project knowledge base, each
  the original file byte for byte with one added header line naming the original path
  and the date moved, all linked from `PROJECT.md` → Documents:
  `research-firstmate`, `research-paperclip`, `research-synapse`, `research-openspec`,
  `research-worktrunk`, and `design-design-contract`,
  `design-claude-design-prompt`, `design-claude-design-followup-1`.
- **The binaries are deleted outright**, not preserved: `docs/design/mockup/`
  (the 256 KiB truncated `.dc.html` export and its 69 KB generated `support.js`) and
  the eleven PNGs under `docs/design/screens/`. They are regenerable and cannot live
  in a markdown knowledge base.
- **`docs/research/` and `docs/design/` are removed** from the tree and added to
  `.gitignore`, so neither can return by accident.
- **Every reference is rewritten**, not just unlinked, so no reader is sent to a path
  that does not exist and no claim is left stranded: `docs/PLAN.md` (companion-file
  list, the §11.5 worktrunk contract, the §21 design-contract paragraph, decision-log
  row 24, the §24 appendix bullet), `README.md`, `CLAUDE.md` ("read these three
  first" is now two), `skills/README.md`, and the header comments of
  `packages/core/src/worktrees/wtconfig.ts` and `packages/core/src/openspec/cli.ts`.

## Capabilities

No capability changes: this removes documentation and rewrites comments and prose, and
no daemon behaviour is affected. `skip_specs: true`.

## Impact

- Deleted: `docs/research/` (5 markdown files) and `docs/design/`
  (3 markdown files, 2 mockup files, 11 screenshots).
- Modified: `docs/PLAN.md`, `README.md`, `CLAUDE.md`, `skills/README.md`,
  `.gitignore`, `packages/core/src/worktrees/wtconfig.ts`,
  `packages/core/src/openspec/cli.ts` (the last two are comments only, no behaviour).
- Nothing under `packages/` imported or linked into either directory, so no code
  changes were needed beyond those two comments.
- The archived VS-87 change (`openspec/changes/archive/2026-09-07-vs-87-…`) still
  names `docs/research/` and `docs/design/` in its proposal and task list. That is a
  dated record of what that ticket audited, not a link, and rewriting it would falsify
  the archive, so it is left as it stands. This change's own artifacts name both paths
  for the same reason.

## Out of scope

- Rewriting git history. Both directories remain in every past commit; whether to
  scrub history or publish from a fresh snapshot is the captain's call before the
  repository goes public.
