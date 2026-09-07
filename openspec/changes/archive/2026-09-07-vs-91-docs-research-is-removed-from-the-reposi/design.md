## Context

Both directories are the only in-tree record of why large parts of the design are what
they are, and parts of them must not be republished: `docs/research/` contains
third-party prompt text, `docs/design/` a paid design tool's export. Losing them is not
acceptable; publishing them is not acceptable.

## Decisions

**Preserve as knowledge documents, verbatim, before deleting anything.** The project
knowledge base lives in the workspace directory, not in the repository, so it is not
published with the repo but is readable by every future worker on this project. One
document per file, slug `research-<name>` / `design-<name>`, so a reference can name a
specific report. Bodies are copied byte for byte — a summary would lose exactly the
verbatim prompt wording and the exact token values that made the files worth keeping.
Each document gains one header line naming the original path and the move date.

The per-document budget is 10,000 estimated tokens (`ceil(bytes / 3.5)`). The largest
file, `firstmate.md`, estimates at 6,824 — every file fits, so no split was needed.

**The binaries are deleted, not preserved.** `docs/design/mockup/` and
`docs/design/screens/*.png` cannot live in a markdown knowledge base, and the captain
called them regenerable. `design-design-contract`'s header says so explicitly, because
that document's own first paragraph cites the mockup export as its source and a reader
would otherwise go looking for it. The screenshots were evidence attached to VS-79/80/81
and are reproducible from the harness the KB documents.

**Rewrite the referring text rather than deleting it.** Each reference cited the moved
file for a specific fact, so each now states that fact directly: the worktrunk contract
is attributed to `wt` v0.68.0 verified 2026-09-03, the OpenSpec JSON shapes to
OpenSpec's own `docs/agent-contract.md` and `docs/cli.md`, and the visual contract to
`packages/ui/src/index.css` plus PLAN §21, which is the brief the contract was written
from and stays in the tree. `CLAUDE.md` pointed a contributor at the design contract as
one of three files to read first; dropping the row without replacement would leave a
contributor with no answer at all, so it gains a paragraph saying where the visual truth
now lives and that it is not published.

**Gitignore both paths.** The captain asked for it explicitly, and it is what stops a
future agent from recreating either directory by habit and re-publishing the contents.

**Leave the archived VS-87 change alone.** It names both paths in the past tense as
things it audited. An OpenSpec archive is a record of what happened; editing it to hide
paths that existed at the time would make the record wrong, and it is a mention rather
than a link.

## Risks

The knowledge base is workspace state and is not backed up with the repository. If the
workspace is lost, the prose is lost, since it will no longer be at the tip of the repo
— it remains recoverable from git history for as long as history is kept, which is the
same condition the out-of-scope note leaves open. The mockup export and the screenshots
are not recoverable that way once history is scrubbed; they were judged regenerable.
