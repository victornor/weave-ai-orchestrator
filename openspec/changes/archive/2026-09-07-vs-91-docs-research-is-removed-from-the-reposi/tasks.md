## 1. Preserve

- [x] 1.1 Write each of the five `docs/research/*.md` files as a project knowledge document (`research-firstmate`, `research-paperclip`, `research-synapse`, `research-openspec`, `research-worktrunk`), body verbatim plus one header line naming the original path and the move date.
- [x] 1.2 Write each of the three `docs/design/*.md` files the same way (`design-design-contract` first, since `packages/ui` was built against it, then `design-claude-design-prompt` and `design-claude-design-followup-1`).
- [x] 1.3 Verify all eight stored documents are byte-identical to their sources once the header line is removed.
- [x] 1.4 Link all eight from `PROJECT.md` → Documents so none is an orphan.

## 2. Remove

- [x] 2.1 `git rm -r docs/research`, and `git rm -r docs/design` including `mockup/` and the eleven `screens/*.png`, which are deleted outright rather than preserved.
- [x] 2.2 Add `docs/design/` and `docs/research/` to `.gitignore` so neither returns by accident.
- [x] 2.3 Confirm nothing under `packages/` imports or links into either directory (only two header comments referred to them).
- [x] 2.4 Rewrite every reference so each states the fact it cited the moved file for: `docs/PLAN.md` (companion list, §11.5 worktrunk contract, §21 design contract, decision-log row 24, §24 appendix bullet), `README.md`, `CLAUDE.md`, `skills/README.md`, `packages/core/src/worktrees/wtconfig.ts`, `packages/core/src/openspec/cli.ts`.
- [x] 2.5 `rg 'docs/design|docs/research'` returns only `.gitignore`, this change's own artifacts and the archived VS-87 change, both of which are records that must name what they changed.

## 3. Verify

- [x] 3.1 `pnpm lint`, `pnpm typecheck` and `pnpm test` are green.
- [x] 3.2 `openspec validate --strict` from the repository root passes for this change.
- [x] 3.3 PR updated to cover both directories, synced with `main`, and merged.
