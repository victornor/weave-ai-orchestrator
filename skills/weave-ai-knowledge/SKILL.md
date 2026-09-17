---
name: weave-ai-knowledge
description: What belongs in the project knowledge base, the workspace knowledge base, the repo or the ticket — how to write a durable entry, and how to run a curation turn. Load before writing a knowledge note, and on any curation ticket.
---

# Knowledge

The knowledge bases are the memory between sessions. Nothing else carries context forward except the repository and the ticket record. They are budgeted, so every entry competes with every other one.

## Where a fact belongs

Ask in this order and stop at the first yes:

1. **Is it task state, a finding, or a decision about this one ticket?** → the ticket: a comment, a `report` document, a work product. Never a knowledge base.
2. **Would a future contributor to this repo need it, with or without Weave AI?** → the **repo**: its `AGENTS.md`, its docs, its specs. It goes through your PR like any other change. Do not copy repo content into a knowledge base; point at it.
3. **Is it about working on this project from the outside — the stack, the commands, a convention the repo does not state, a landmine, a hard-won lesson?** Decide by **subject**, not by length. Check `weave_knowledge_docs` (or the pointer left in `PROJECT.md`'s Documents/Landmines/Conventions sections) for a document already covering the subject: if one exists, `weave_knowledge_note("project", section, text, doc: slug)` appends your entry into it. If the subject has no document yet, **create one** — `weave_knowledge_doc_put(slug, body)`, one entry is reason enough, do not wait for a second — linked from `PROJECT.md`'s Documents section and from related documents with `[[slug]]`. Only when the fact fits no subject at all does it go to `knowledge/projects/<id>/PROJECT.md` directly, via `weave_knowledge_note("project", section, text)`. See `references/documents.md`.
4. **Is it project-agnostic and true everywhere in this workspace — a house convention, a term, a matter of tone?** → `SHARED.md`. **Weaver only**, and it must never name a project, a repo, a client or a role.
5. **Is it about the business, the portfolio, the human, or a standing policy?** → `WORKSPACE.md`. **Weaver only**; workers cannot read it.
6. **Is it a durable decision?** → `decisions.md`, one line, appended by the daemon when a decision is marked durable.

Sections are fixed. `PROJECT.md`: Overview · Stack & commands · Conventions · Current focus · Landmines · Documents · Learnings. `WORKSPACE.md`: Business · People & preferences · Portfolio · Policies · Standing instructions. `SHARED.md`: Conventions · Glossary · Tone.

## Writing an entry

`weave_knowledge_note(scope, section, text)`, or `weave_knowledge_note(scope, section, text, doc: slug)` to append into an existing linked document instead of the hub — the document must already exist (`not_found` names `weave_knowledge_doc_put` otherwise).

- **≤ 60 words.** The daemon rejects longer.
- **Standalone.** No pronouns, no "as discussed", no reference to your ticket unless you name it. The next reader has no other context.
- **Absolute dates.** "2026-09-04", never "last week".
- **Durable.** Not task state. Not anything derivable from git, the repo, or the specs. Never a secret, a token or a URL with credentials in it.
- **At most one note per ticket**, usually on the merge turn, answering: *what would I have wanted to know before I started this?*
- **Perishable?** Mark it: `<!--exp:2026-12-01-->`. Expired entries are archived automatically.

A rejection is information, not an obstacle. The daemon rejects near-duplicates, over-length entries and writes that would break the budget, and it tells you the current size and which sections are over. **Do not retry a rejected write and do not reword it past the check.** Say so in your final report; an over-budget rejection schedules a curation run.

**Good:** "2026-09-04 The integration suite needs `DATABASE_URL` pointing at a scratch database; `pnpm test:int` creates and drops it, but fails silently if the role lacks CREATEDB."
**Bad:** "Tests were tricky." · "See ACME-42." · "We use Postgres." (the repo says so) · "Remember to run the tests." (everyone knows)

## Reading before writing

`weave_knowledge_docs` lists every document you can read with a one-line summary; `weave_knowledge_search(query)` finds hub entries and documents by text; `weave_knowledge_doc_get(slug)` returns a document with `linksTo` and `linkedFrom`, so you can walk the graph as deep as the question needs. Read first, then update the existing page rather than writing a near-duplicate.

## Curation

A curation turn is triggered when a file crosses 80% of its budget, 14 days after the last one, on `weave knowledge curate`, or after an over-budget rejection. Workspace files are curated by the weaver; a project KB is curated by a curation worker on a "Curate project knowledge" ticket with no worktree of its own.

**You may merge, move, tighten, archive and remove. You may never add a fact.** Full procedure: `references/curation.md`.

Submit the rewritten file with `weave_knowledge_replace(scope, body, supersedes)`. `supersedes` names the specific existing entries the rewrite corrects — a distinctive fragment of each; a claim that matches no entry is rejected. The daemon diffs it, archives every removed entry with its provenance, records the superseded claims on the revision, and records the diff on the ticket so the human can review or revert. Then comment on the ticket listing every removed entry with its reason, and transition to `done`.

## References

- `references/documents.md` — linked documents: when to write one, shape, linking, traversal.
- `references/curation.md` — the curation procedure, step by step.
- `references/placement.md` — worked placement examples, and the entries that should never exist.
