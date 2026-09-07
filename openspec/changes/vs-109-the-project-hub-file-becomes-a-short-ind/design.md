# Design — subject documents instead of a growing hub wall

## Context

`PROJECT.md`'s Landmines section is close to forty dated, one-off code facts, most of them the entire
payload of one ticket's `ac_knowledge_note` call. The hub is not curatable down: curation
(`skills/agent-conductor-knowledge/references/curation.md`) may merge near-duplicates and tighten
prose, but it may never remove a fact, and these are forty *different* facts. The only way to shrink
the hub without losing anything is to move content out of it — and linked documents
(`packages/core/src/knowledge/service.ts`: `getDoc`/`putDoc`/`listDocs`) already exist for exactly
this. Three already sit in this project's Documents section: `run-engine`, `release-and-upgrade`,
`knowledge-documents`.

Two gaps keep that mechanism from draining the wall:

1. `note()` (`service.ts:301-331`) only ever calls `ensure(scope, projectId)`, which resolves to one
   of the four hub files (`files.ts:relPathFor`). There is no path from "I hit a jsdom quirk" to "one
   line lands in the `web-app-testing` document" — only to the hub. Getting a line into a document
   today means `ac_knowledge_doc_get`, editing the whole body by hand, and `ac_knowledge_doc_put`ing
   it back — for one line, that is more friction than the hub append it is supposed to replace, so
   nobody does it.
2. A worker's bootstrap digest and its rendered `AGENTS.md` both carry the full hub body
   (`bootstrapDigest()`, `service.ts:451-486`, and `{{knowledge.project}}` in
   `templates/worker.AGENTS.md.tmpl`) but never a document — by design
   (`knowledge-documents` document, and this ticket's own "out of scope" says not to change that).
   Nothing in the worker's turn loop today says "go read one."

## Goals / non-goals

- **Goals.** Make "add one durable fact to an existing subject document" as cheap as the hub append it
  replaces. Make reading the relevant document before touching an area the normal path, stated in the
  places a worker actually reads (skill, brief, charter), not a thing to discover. Shrink
  `agent-conductor`'s own hub as the worked example, with nothing lost.
- **Non-goals.** Changing the budgets or the curation algorithm (VS-102's health view already reports
  both — ticket's own "Out of scope"). Putting documents into the bootstrap digest — that recreates
  the same wall with extra steps (ticket's own "Out of scope"). A generalised "any hub section can
  become a document" framework beyond Landmines/Conventions — nothing else on the hub has this shape
  today. Restructuring `fernwood`'s hub from this ticket — see "Project boundary" below.

## Decisions

### `doc` is an optional parameter on the existing `ac_knowledge_note`, not a new tool

A worker already reaches for `ac_knowledge_note` the moment it learns something; adding a fourth
knowledge-write tool (`ac_knowledge_doc_note`?) for what is conceptually "the same append, a different
target" would be one more name to remember and one more place the placement guidance has to explain.
`note(actor, scope, section, text, projectId, doc?)` keeps the existing signature and the existing
tool name; `doc` present means "append into this linked document's `## section`" instead of the hub.

**Rejected: reuse `ac_knowledge_doc_put` for single-line appends.** `putDoc` (`service.ts:517-539`)
takes a whole new body and replaces the document outright — using it for one line means the caller
must already hold the current body (a `ac_knowledge_doc_get` round trip) and reproduce the parts it
did not touch, exactly the friction this change removes. `note()`'s existing job — parse, find or
create a `##` section, append a bulleted, dated, deduplicated, length-checked line, re-render, budget
check — is already section- and file-agnostic in every helper it calls (`parseDoc`, `findSection`,
`appendEntry`, `entriesOf`, `similarity`, `renderDoc`, all in `files.ts`); only `ensure()` is hub-only.

### The target document must already exist

`note(..., doc: slug)` resolves the document with `locateDoc()` (`service.ts:179-187`, the same
resolver `getDoc`/`putDoc` use) and throws `not_found` — naming `ac_knowledge_doc_put` as the way to
create one — when the file is missing, rather than silently seeding a bare document the way `ensure()`
seeds a bare hub file (`seedBody`, `files.ts:202-214`). A hub file has a fixed shape a seed can produce
correctly; a document's `# Title` and its subject are exactly the part a bare append cannot invent.
This also keeps the invariant `putDoc` already enforces — every document starts as a deliberate
`# Title` + summary — intact for every document, not just ones created through `putDoc` directly.

### The document's own budget and duplicate set apply, not the hub's

`budgetFor(scope, path)` (`files.ts` `budgetOf`, called from `service.ts:59-64`) already dispatches on
`isDocPath(path)`, so a document row's budget is already the configured document budget wherever
`write()` reads it (`write()`, `service.ts:195-239`, calls `budgetOfRow(row)`) — the doc-targeting
branch of `note()` needs no new budget logic, only to fetch the document's row and body instead of the
hub's. Near-duplicate detection (`entriesOf`/`similarity`, `DUPLICATE_THRESHOLD`) runs over the
document's own bullets, so a landmine that already has a near-duplicate line in the target document is
rejected exactly as a near-duplicate hub entry is today; an over-budget document write schedules
curation on that document's scope exactly as an over-budget hub write does (`fireCuration`, unchanged).

### Surfaces threaded through unchanged in shape

`ac_knowledge_note` (`packages/server/src/tools.ts:307-311`), `POST /:scope/note`
(`packages/server/src/routes/knowledge.ts:31-33`) and `conductor knowledge note`
(`packages/cli/src/commands/knowledge.ts:94-106`) all gain one optional field/flag
(`doc` / `--doc <slug>`) passed straight through to `note()`. No new route, no new CLI command, no
change to the MCP tool's name or its other fields — an existing caller that never sends `doc` sees
identical behaviour to today.

### Worker guidance: read before touching, choose the write target by whether a document exists

Three places currently tell a worker what to do at the top of a turn and what to do with a new fact;
all three gain the same two sentences, not three different phrasings of it:

- `templates/brief.md.tmpl` (Setup, right after "read `work/AGENTS.md` once"): check the hub's
  Documents section (and any pointer left in Landmines/Conventions) for one relevant to the file or
  subsystem about to be touched, and read it with `ac_knowledge_doc_get` before starting.
- `templates/worker.AGENTS.md.tmpl` ("Each turn", step 2, same place `ac_worktree_status` and reading
  `work/AGENTS.md` already live): the same instruction, since this file — not the brief — is what a
  relaunched worker re-reads.
- `templates/charter.md.tmpl` (the fixed "Knowledge." paragraph): states the tool choice — `doc:
  slug` on `ac_knowledge_note` when a document for the subject exists, `ac_knowledge_doc_put` for a
  genuinely new subject, a plain hub `ac_knowledge_note` only for something that fits no subject.

**Rejected: put the instruction only in the `agent-conductor-knowledge` skill.** That skill is loaded
"before writing a knowledge entry" (its own frontmatter) — after a worker has already decided it has
something to write, not before it starts touching a file. The read-before-touching behaviour has to
land before that point, which is the brief/`AGENTS.md`'s job; the skill still carries the fuller
placement rules for when a worker does reach the writing decision.

### The tool choice is decided by subject, not by how much there is to say

Captain's post-approval clarification (2026-09-07): worded as first drafted, the charter's three-way
choice reads as "target a document if one exists, otherwise the hub" — which resolves to the hub for
every early fact on a brand-new project, since nothing has a document yet, recreating exactly the
accumulation this change exists to stop. The fix is in the ordering, not a new mechanism: a document
is created **on the first fact about its subject**, one entry is reason enough — the plain hub note is
the last resort for a fact that fits no subject at all, never the default for "no document exists
yet." `templates/charter.md.tmpl`, `templates/worker.AGENTS.md.tmpl`'s closing knowledge step, and the
`agent-conductor-knowledge` skill's placement rule and `references/documents.md`/`references/placement.md`
all restate the choice in that order.

### The seed's per-section hints already had a mechanism to say this

`PROJECT_SECTION_HINTS` (`packages/core/src/workspace/loader.ts`) already renders one hint line under
each section of a brand-new project's `PROJECT.md` — `projectKnowledgeSkeleton()`, run at project add.
Restating the subject-first, create-on-first-fact rule in the Landmines and Conventions hints is a
wording change to two string literals, not a new code path, so it is in scope here: a fresh project's
hub now carries the same guidance from the moment it exists, not only once a worker's rendered
`AGENTS.md`/charter tells it so. `packages/core/src/knowledge/files.ts`'s `seedBody()` — the knowledge
service's own fallback skeleton, used when it finds no file on disk rather than at project add — has
no per-section hint slot at all, only one blurb for the whole file; giving it the same per-section
hints would mean restructuring `skeleton()`'s loop, which is a small change but not a wording one, and
is not made here. It is a pre-existing gap between the two seed paths, not introduced by this change,
and is reported rather than absorbed.

### Restructuring the hub is a one-time move, executed with existing tools, not new code

Moving today's ~40 Landmines entries and the Conventions section into subject documents needs no new
mechanism beyond what this change ships: `ac_knowledge_doc_put` to create or extend a subject document
verbatim, then `ac_knowledge_replace` to rewrite the hub's Landmines/Conventions sections down to
one-line pointers (`ac_knowledge_replace`'s own description says "only valid inside a curation run";
this restructuring is exactly that shape of edit — moving and tightening, adding no fact — done under
this ticket's explicit mandate rather than a separate curation ticket, since the ticket's whole
acceptance criteria describe this exact move). Every entry that already names an existing document's
subject extends that document (`run-engine`, `release-and-upgrade`, `knowledge-documents`); a subject
with no existing document gets one new document. The exact per-entry mapping is worked out during
apply, not fixed here, but the rule is fixed: **update an existing document on the same subject before
creating a new one** (the same rule `references/documents.md` already states for any new document).

Verification (ticket's own "Verification" section): before rewriting the hub, the full list of
Landmines/Conventions bullets and their normalized text is captured; after every document write and
the hub rewrite, the same extraction is run again over every document plus the rewritten hub, and the
two sets are compared — every pre-restructure bullet must appear, verbatim, in exactly one place
afterward. Every `VS-NN` ticket reference inside a moved bullet is checked to still resolve
(`ac_ticket_get`) so a moved landmine does not silently point at a ticket dropped in transcription.

### Project boundary: `fernwood` is explicitly not touched by this ticket

`knowledgeScope()` (`packages/server/src/tools.ts:70-77`) throws `forbidden` — "workers may only read
their own project knowledge" — the instant a non-conductor caller names a `projectId` other than its
own. This worker's every knowledge tool call is bound to the `agent-conductor` project by that check;
there is no path from inside this ticket to `fernwood`'s hub. The acceptance criterion asking for the
same treatment there is real, but it names work only the conductor (who is not project-scoped) or a
worker on a `fernwood` ticket can do. This ticket ships the mechanism and the worked example; the
`fernwood` restructuring is called out as a follow-up in the PR and a ticket comment, not silently
dropped and not attempted from here.

## Risks / trade-offs

- **A document-targeted note can still grow a document past its own budget** the same way a hub entry
  can grow the hub — accepted, because that is exactly what scheduled curation on documents already
  exists to catch (`knowledge/scheduled-curation`, `DOCUMENT_STALE_MS`/`CURATION_BUDGET_FRACTION` in
  `files.ts` already apply to any file, hub or document).
- **The per-entry subject mapping is a judgement call made during apply**, not pinned down entry by
  entry in this design. Accepted: the verification step (entry-set diff, ticket-reference check) is
  the safety net, not a pre-agreed mapping table that would go stale the moment a new landmine lands
  between propose and apply.
- **The hub-restructuring write uses `ac_knowledge_replace`, nominally a curation-only tool, from a
  `change` ticket rather than a dedicated curation ticket.** Accepted for this one-time move because
  the ticket's acceptance criteria describe exactly this edit and require it to happen inside this
  ticket's own project boundary; the `references/curation.md` update in this change also states that a
  *future* hub-section-to-document split of this shape is a normal curation-turn move, so the next one
  goes through a curation ticket rather than a `change` ticket again.

## Migration

None to the database or config. The hub and document rewrites are content-only knowledge-base writes
against the running workspace, made through `ac_knowledge_doc_put`/`ac_knowledge_replace` during apply
— not part of this PR's diff, since that content lives in the workspace's knowledge store, not in this
git repository. Every removed hub line is archived by `replace()`'s existing archival path
(`archiveEntries`, `service.ts:241-247`) before it is gone from the live file, so it remains
recoverable through the existing revision history regardless of this change.
