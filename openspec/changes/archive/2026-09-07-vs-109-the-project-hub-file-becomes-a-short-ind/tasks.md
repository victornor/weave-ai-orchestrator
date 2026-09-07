## 1. `ac_knowledge_note` can target an existing linked document

- [x] 1.1 `packages/core/src/api.ts`: `KnowledgeService.note`'s signature gains an optional trailing
      `doc?: string` parameter.
- [x] 1.2 `packages/core/src/knowledge/service.ts`: `note()` branches on `doc` — resolve the document
      with `locateDoc()`, `not_found` (naming `ac_knowledge_doc_put`) if it does not exist yet, then
      run the same parse/find-or-create-section/dedupe/length/budget/append/`write()` path already
      used for the hub, against the document's row and body instead. Reuses `parseDoc`, `findSection`,
      `appendEntry`, `entriesOf`, `similarity`, `renderDoc`, `write` unchanged; `budgetFor`/`budgetOfRow`
      already resolve the document budget correctly via `isDocPath`.
- [x] 1.3 `packages/server/src/tools.ts`: `ac_knowledge_note`'s input schema gains
      `doc: z.string().min(2).optional()`; the handler passes it through, resolving the document's
      project scope with the existing `knowledgeScope()` guard (a worker naming another project's
      document is rejected exactly as any other knowledge call today).
- [x] 1.4 `packages/server/src/routes/knowledge.ts`: `POST /:scope/note` accepts an optional `doc` in
      its body and passes it through.
- [x] 1.5 `packages/cli/src/commands/knowledge.ts`: `conductor knowledge note` gains a `--doc <slug>`
      option, threaded through both the tool-shaped and HTTP-shaped `client.write` call.
- [x] 1.6 `docs/API.md`: update the `POST /knowledge/:scope/note` line to mention the optional `doc`
      body field.
- [x] 1.7 Tests in `packages/core/src/knowledge/knowledge.test.ts`: happy path (appends to the named
      document, not the hub), `not_found` when the document does not exist, near-duplicate rejected
      against the document's own entries (a duplicate of a hub entry is *not* rejected when targeting
      a document, and vice versa), over-budget rejection schedules curation for the document's scope,
      a call with no `doc` behaves exactly as today. Route-level test in
      `packages/server/test/knowledge.test.ts` for the `doc` field round-tripping through
      `POST /:scope/note`.

## 2. Tell a worker to read the relevant document before it starts

- [x] 2.1 `templates/brief.md.tmpl`: in "Setup", right after "Then read `work/AGENTS.md` … once",
      add an instruction to check the hub's Documents section (and any pointer left in
      Landmines/Conventions) for a document relevant to the file or subsystem about to be touched, and
      to read it with `ac_knowledge_doc_get` before starting.
- [x] 2.2 `templates/worker.AGENTS.md.tmpl`: "Each turn", step 2 (`ac_worktree_status`, then read
      `work/AGENTS.md`), gains the same instruction — this is the file a relaunched worker re-reads,
      so the instruction has to live here too, not only in the brief.
- [x] 2.3 `templates/charter.md.tmpl`: the fixed "Knowledge." paragraph states the three-way tool
      choice for a new fact — `ac_knowledge_note(..., doc: slug)` when a document for the subject
      exists, `ac_knowledge_doc_put` for a genuinely new subject, a plain hub `ac_knowledge_note`
      when the fact fits no subject document.
- [x] 2.4 `skills/agent-conductor-worker/SKILL.md`: step 2 of "The turn loop" (worktree status, read
      `AGENTS.md`) gains a one-line pointer to the same read-the-relevant-document behaviour, so the
      skill and the templates agree.
- [x] 2.5 `skills/agent-conductor-worker/references/tools.md`: `ac_knowledge_note`'s row documents the
      new `doc` parameter.

## 3. Placement and curation guidance route new facts to subject documents

- [x] 3.1 `skills/agent-conductor-knowledge/SKILL.md`: placement rule #3 ("about working on this
      project from the outside…") states that a document already covering the subject is extended
      with `ac_knowledge_note(scope, section, text, doc: slug)`, not rewritten whole.
- [x] 3.2 `skills/agent-conductor-knowledge/references/documents.md`: the hub-vs-document table gains
      the `doc`-targeted `ac_knowledge_note` row; "Before writing" gains a step for the one-line-append
      case (check `ac_knowledge_docs`/the hub's Documents section for an existing document on the
      subject before reaching for `ac_knowledge_doc_put`).
- [x] 3.3 `skills/agent-conductor-knowledge/references/placement.md`: a worked example — a landmine
      about a subsystem that already has a document goes to that document via the new `doc` parameter,
      not the hub.
- [x] 3.4 `skills/agent-conductor-knowledge/references/curation.md`: states that splitting an overgrown
      hub section into a subject document, with a one-line pointer left behind, is a normal curation
      move (this ticket's own restructuring is the worked example), so the next time a hub section
      grows this way it goes through a curation ticket rather than a `change` ticket.

## 4. OpenSpec capabilities

- [x] 4.1 `specs/knowledge/document-notes/spec.md` — ADDED requirements for the `doc`-targeted note,
      its existence requirement, and its project-boundary check.
- [x] 4.2 `specs/worker-supervision/document-briefing/spec.md` — ADDED requirements for the
      brief/`AGENTS.md` instruction and the charter's tool-choice guidance.

## 5. Restructure the `agent-conductor` project's own hub

- [x] 5.1 Read the live `PROJECT.md` (`ac_knowledge_get("project")`) and the existing documents
      (`ac_knowledge_docs`, then `ac_knowledge_doc_get` on `run-engine`, `release-and-upgrade`,
      `knowledge-documents`). Capture every Landmines and Conventions bullet's exact text, date and
      ticket reference as the before-set for verification.
- [x] 5.2 Group every captured entry by subject, following design.md's rule — extend an existing
      document when its subject already has one (`run-engine`, `release-and-upgrade`,
      `knowledge-documents`); otherwise assign it to a new document. Today's content is expected to
      need new documents for at least: web-app testing and jsdom (packages/ui, vitest, jsdom
      quirks), tickets and OpenSpec (transitions, propose/apply, validation traps), and credentials
      and runtimes (auth, launcher, symlinked credentials, the phone/viewport keyboard-and-safe-area
      entries) — confirm the final grouping against what is actually there, not this list.
- [x] 5.3 Write each subject document with `ac_knowledge_doc_put` (new documents) — verbatim entries
      under headings that mirror their source section (`## Landmines`, `## Conventions`), a `# Title`
      and one-line summary for each new document. Extend the three existing documents the same way
      rather than duplicating their existing content.
- [x] 5.4 Rewrite `PROJECT.md`'s Landmines and Conventions sections down to one-line pointers (one per
      subject document, in the section it replaces), with enough words that a worker can tell whether
      it is relevant to the file about to be touched, and update the Documents section for any newly
      created document. Apply with `ac_knowledge_replace("project", body)`.
- [x] 5.5 Verify nothing is lost: re-extract every bullet from the rewritten hub plus every document
      and compare against the before-set from 5.1 — every entry present exactly once, none reworded
      beyond the heading it now sits under. Spot-check that ticket references inside moved entries
      still resolve (`ac_ticket_get`). Record the hub's token count before and after
      (`ac_knowledge_get("project").tokenEstimate`) in the ticket comment and PR description.
- [x] 5.6 Comment on the ticket (and note in the PR description) that AC6 — the same treatment for
      `fernwood` — is out of this ticket's reach: a worker's knowledge tools are scoped to its own
      project (`knowledgeScope()`, `packages/server/src/tools.ts`), so this has to be done by the
      conductor directly or by a `fernwood`-scoped ticket, once this change has merged.

## 6. Verification

- [x] 6.1 `pnpm typecheck && pnpm lint && pnpm test` green.
- [x] 6.2 State `agent-conductor`'s `PROJECT.md` token count before and after restructuring, in the PR
      description and a ticket comment, per the ticket's Verification section.

## 7. Post-approval refinement: subject-first tool choice (captain, 2026-09-07)

- [x] 7.1 `templates/charter.md.tmpl`: reword the Knowledge paragraph so the choice is by subject, not
      length — create a document on the first fact about a subject; the plain hub note is the last
      resort, not the default when no document exists yet.
- [x] 7.2 `templates/worker.AGENTS.md.tmpl`'s closing knowledge step (item 9): same reordering.
- [x] 7.3 `skills/agent-conductor-knowledge/SKILL.md` placement rule #3, `references/documents.md`
      ("When to write a document", "Before writing"), `references/placement.md` (the CREATEDB example):
      restate subject-first, create-on-first-fact.
- [x] 7.4 Investigated `PROJECT_SKELETON`/`PROJECT_SECTION_HINTS` (`packages/core/src/workspace/loader.ts`)
      and `seedBody()` (`packages/core/src/knowledge/files.ts`) per captain's question. Fixed: the
      Landmines/Conventions hints in `PROJECT_SECTION_HINTS`, a wording change to two string literals
      — a fresh project's seeded hub now states the rule from day one. Reported, not absorbed:
      `seedBody()`'s `skeleton()` has no per-section hint slot at all (only one whole-file blurb), so
      giving it the same hints needs a small restructure of that function, not a wording edit; noted
      in `design.md` and the ticket comment as a pre-existing gap between the two seed paths.
