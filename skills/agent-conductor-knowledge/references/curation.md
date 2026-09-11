# Curation procedure

Curation makes a file smaller and truer. It never makes it newer.

## The one rule

**Never add a fact.** Not one you know, not one that is obviously true, not one you noticed while fact-checking. You may merge, move, tighten, archive and remove. If the file is missing something important, say so in the ticket comment — a later ticket adds it.

## Steps

1. **Read the whole file.** `ac_knowledge_get(scope)`. Not a section, the whole thing — merges only become visible across sections.
2. **Fact-check, for a project KB.** `work/` is the project's primary clone, read-only — verified current against the landing branch immediately before this turn started (VS-256); it is not something you need to freshen or double-check yourself. Verify every claim you can: commands still exist, paths still exist, the landmine is still a landmine. Do not write to `work/`, do not commit, do not push.
3. **Merge duplicates.** Two entries saying the same thing become one, keeping the earliest date and the clearest wording.
4. **Promote learnings that became conventions.** A Learnings entry that three tickets have relied on is a Convention. Move it, restate it as a rule, drop the date narrative.
5. **Remove what the repo now says.** Anything stated in `AGENTS.md`, the docs or the specs is redundant here. Replace it with a pointer, or delete it.
6. **Remove what is contradicted.** If the codebase positively disagrees with an entry, the entry goes. Note the contradiction in your ticket comment. **If you cannot tell either way** — a path or command the checkout doesn't clearly confirm or refute, something that may have moved rather than disappeared — leave the entry and say so in your ticket comment instead. Only remove a fact you positively verified is now false; an unresolved claim is reported, never removed on a guess.
7. **Archive the stale.** Expired `<!--exp:-->` markers, entries about code that no longer exists, focus items from finished quarters.
8. **Tighten.** Cut hedging, background and prose. Every entry should read as one fact.
9. **Rebalance.** Keep each section inside its share of the budget. Learnings is the section that grows and the first that should shrink; Overview and Stack & commands are stable and should survive intact. When Landmines or Conventions has become a wall of one-off facts on the same few subjects, this is where a **move**, not an addition, belongs: extend an existing document (`ac_knowledge_docs` first — update one on the subject if it exists) or create a new one (`ac_knowledge_doc_put`) with the entries verbatim, and leave a one-line pointer in the hub section in their place. This is exactly the shape of VS-109's initial hub restructuring; a hub section that has grown this way again is a normal curation move, not a reason to file a new `change` ticket.
10. **Submit.** `ac_knowledge_replace(scope, body)` with the complete new file — the same headings, in the same order, none dropped even if empty.
11. **Account for it.** Comment on the ticket: every removed entry and its reason, one line each. Then `ac_ticket_transition(id, "done")`.

## Guarantees you are upholding

- The curated file is at or under budget.
- Nothing was deleted without an archive copy carrying its provenance.
- No fact in the file is one you invented during curation.
- Every section heading the file started with is still there.

## For a workspace file

Same procedure, minus the fact-check against a worktree. The Portfolio section in `WORKSPACE.md` must match `ac_project_list()` exactly — that is the conductor's routing table, and a stale line there sends work to the wrong project. `SHARED.md` gets one extra pass: **delete anything that names a project, a repo, a client or a role.** That file is read by every worker in every project, and it is the one place a leak of the portfolio would be invisible.
