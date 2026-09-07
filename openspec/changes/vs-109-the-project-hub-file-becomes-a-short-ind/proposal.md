## Why

Captain (2026-09-07): "Did it just curate from 8000 to 7400 tokens? Maybe we need to break out
larger context into documents and provide document links in the knowledge base instead?"

Curation can only merge near-duplicates and tighten prose; it cannot fix the shape of the problem.
`knowledge/projects/agent-conductor/PROJECT.md` is at ~7,600 of 10,000 tokens and its Landmines
section alone is roughly forty entries, almost all of them one specific code fact from one ticket: a
jsdom quirk, a Hono route-ordering trap, a Tailwind layer precedence rule. Each is worth keeping.
Together they are a wall that grows by several entries a day, and every worker reads the whole thing
on every turn because the hub is injected into `work/AGENTS.md` in full
(`templates/worker.AGENTS.md.tmpl`'s `{{knowledge.project}}`).

Linked documents already exist as a mechanism (`ac_knowledge_doc_get/put/docs`,
`packages/core/src/knowledge/service.ts`) and this project's own hub already links three of them
(`run-engine`, `release-and-upgrade`, `knowledge-documents`). But a linked document is not in a
worker's bootstrap digest (`knowledge-documents` states this explicitly, and
`KnowledgeService.bootstrapDigest` in `service.ts:451` confirms it), so moving the Landmines wall
into documents without anything else trades a hub nobody can finish reading for documents nobody
opens. Two things are missing today:

1. **No ergonomic way to add one line to an existing document.** `ac_knowledge_note` only appends to
   a hub section; adding one landmine to a document means fetching the whole body
   (`ac_knowledge_doc_get`), editing it by hand, and rewriting it whole (`ac_knowledge_doc_put`). That
   friction is exactly why the Landmines section keeps growing instead of draining into documents
   that already exist for the subject.
2. **Nothing tells a worker to go look.** The worker skill, the brief template and the charter
   template never say "check whether a document exists for the area you are about to touch." A
   worker reads the hub once at boot and moves on.

## What Changes

- **`ac_knowledge_note` gains an optional `doc` (slug) parameter.** When given, the entry is appended
  to that linked document's named section instead of the hub — same 60-word limit, same near-duplicate
  rejection, same over-budget rejection-and-curation-schedule, but checked against the document's own
  budget and requiring the document to already exist (`not_found` otherwise, naming
  `ac_knowledge_doc_put` to create it first). This is the one thing a worker calls when it has learned
  a fact that belongs to a subject document that already exists.
- **The worker skill, the brief template and the charter template tell a worker to check the hub's
  Documents section (and any pointer left in Landmines/Conventions) for a document relevant to the
  file or subsystem it is about to touch, and to read it (`ac_knowledge_doc_get`) before starting.**
  The same templates state which tool to use for a new fact: `ac_knowledge_note(..., doc: slug)` when
  a document for the subject exists, `ac_knowledge_doc_put` for a genuinely new subject, a plain
  `ac_knowledge_note` to the hub only for something that fits no subject.
- **The `agent-conductor-knowledge` skill's placement and curation guidance is updated** to route a
  new landmine or convention to its subject document instead of the hub, and to describe splitting an
  overgrown hub section into a subject document (with a one-line pointer left behind) as a standing
  curation move, not a one-off.
- **`knowledge/projects/agent-conductor/PROJECT.md`'s Landmines and Conventions sections are
  restructured**: every existing entry moves, verbatim (date and ticket reference intact), into a
  subject document — extending `run-engine`, `release-and-upgrade` and `knowledge-documents` where an
  entry matches a document that already exists, and into new documents for the subjects that do not
  yet have one (today's content clusters around: web-app testing and jsdom, tickets and OpenSpec,
  credentials and runtimes, and the phone/viewport). The hub sections that held them keep a one-line
  pointer to where the content now lives. This is executed once the change is approved, using the KB
  tools directly against the running workspace (this content lives in the workspace's knowledge store,
  not in this git repository, so it is not part of the PR diff) — see `design.md`'s "Migration".
- **The `fernwood` project's hub is explicitly out of this ticket's reach.** A worker's knowledge tools
  are scoped to its own project (`knowledgeScope()`, `packages/server/src/tools.ts:70`) — a `project`
  argument naming another project is rejected with `forbidden`. This ticket ships the mechanism and
  applies it to `agent-conductor`, the project it runs in; applying the same restructuring to
  `fernwood` is work only the conductor (not project-scoped) or a `fernwood`-scoped ticket can do, and
  is flagged as a follow-up rather than attempted here.

## Capabilities

### New Capabilities

- `knowledge/document-notes`: `ac_knowledge_note` can target an existing linked document instead of
  the hub, with the same guardrails (length, duplicates, budget) applied to the document's own budget.
- `worker-supervision/document-briefing`: a worker's rendered brief and `AGENTS.md` instruct it to
  read the document relevant to the area it is about to touch before starting, and state which
  knowledge tool to use for a new durable fact depending on whether a subject document exists.

## Impact

- `packages/core/src/api.ts`: `KnowledgeService.note`'s signature gains an optional `doc` parameter.
- `packages/core/src/knowledge/service.ts`: `note()` branches to a document target when `doc` is
  given, reusing the existing `parseDoc`/`appendEntry`/`entriesOf`/`similarity`/`write` machinery,
  which is already scope-agnostic (`budgetFor()` already picks the document budget from `isDocPath`).
- `packages/server/src/tools.ts`, `packages/server/src/routes/knowledge.ts`,
  `packages/cli/src/commands/knowledge.ts`, `docs/API.md`: the `doc` parameter threaded through the
  tool, the HTTP route and the CLI command.
- `templates/worker.AGENTS.md.tmpl`, `templates/brief.md.tmpl`, `templates/charter.md.tmpl`: the
  document-reading instruction and the tool-choice guidance.
- `skills/agent-conductor-knowledge/SKILL.md` and its `references/documents.md`, `references/curation.md`,
  `references/placement.md`; `skills/agent-conductor-worker/SKILL.md` and its `references/tools.md`.
- The `agent-conductor` project's live knowledge base (workspace data, not this repository): the
  restructured `PROJECT.md` and the subject documents it now points to.
- No database migration, no config change, no new dependency.
