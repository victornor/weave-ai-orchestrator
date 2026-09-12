# Linked documents

The hub files (`PROJECT.md`, `SHARED.md`, `WORKSPACE.md`) are budgeted summaries. Anything that
belongs to a **subject** — a subsystem, an integration, a testing quirk, a runbook — lives in a
**document** for that subject: one topic page that links to other pages with `[[slug]]`. Together
they form the project's knowledge graph. Think Obsidian, with a budget. Decide by subject, not by
how much you have to say: a document earns its existence on the first fact about its subject, not
once enough facts have piled up to look like one — that pile-up, in the hub, is exactly the wall
this system exists to avoid.

| | Hub file | Document |
|---|---|---|
| Path | `knowledge/projects/<id>/PROJECT.md` | `knowledge/projects/<id>/docs/<slug>.md` |
| Write with | `weave_knowledge_note(scope, section, text)` | `weave_knowledge_doc_put(slug, body)` to create or replace whole; `weave_knowledge_note(scope, section, text, doc: slug)` to append one entry to an existing one |
| Size | the workspace's configured budget for that file (10000 tokens by default) | the configured document budget (10000 tokens by default) |
| Shape | fixed sections, ≤ 60-word entries | `# Title`, a one-line summary paragraph, then whatever the topic needs |
| Found through | always loaded at boot | `weave_knowledge_docs` (catalogue), links, `weave_knowledge_search` |

Shared documents (`knowledge/workspace/shared/<slug>.md`) are readable by every agent and written
by the conductor only. Workspace documents are the conductor's private notes.

## When to write a document

Write one when a future worker would otherwise re-discover the same thing: how a subsystem fits
together, how an integration authenticates and fails, a deployment or release runbook, the data
model of one bounded context, an environment and its quirks. One topic per document — including
a subject whose first known fact is one dated landmine. Do not hold it back in the hub until a
second one arrives; that wait is how the hub grows into a wall.

Do **not** write one for: task state (the ticket), anything the repo already documents (link to
the file instead), code walkthroughs that go stale with every PR, or secrets of any kind.

## Before writing

1. `weave_knowledge_docs` — read the catalogue.
   - A document on the subject already exists and you have one dated line to add — a landmine, a
     convention, a fact of the same shape a hub entry would be — **append to it**:
     `weave_knowledge_note(scope, section, text, doc: slug)`.
   - No document covers the subject yet, even though the fact itself is one line — **create one**:
     `weave_knowledge_doc_put(slug, body)`. A single dated entry under a `# Title` and a one-line
     summary is a complete, valid document; do not default to the hub just because nothing exists
     yet.
   - Reach for `weave_knowledge_doc_get` + edit + `weave_knowledge_doc_put` on an existing document only
     when the change is more than one entry (restructuring, rewriting the summary, fixing links).
2. `weave_knowledge_search("<topic>")` — the hub entries and other documents that touch it.

## Writing

```
# Payments webhook pipeline

Stripe events land in `apps/api/src/webhooks/stripe.ts`, are verified, queued, and applied by
a worker. Retries and idempotency live here; billing state lives in [[billing-data-model]].

## Flow
…

## Failure modes
…

## Related
- [[billing-data-model]] — tables and invariants the worker updates
- [[deploy-runbook]] — how the webhook secret is rotated
```

- **Slug**: kebab-case, stable, 2–64 characters (`payments-webhooks`, not `Payments Webhooks v2`).
- **First line** is `# Title`; the **first paragraph** is the one-line summary shown in the catalogue.
- **Link generously with `[[slug]]`** to related documents, and link the document **from
  `PROJECT.md`** (`weave_knowledge_note("project", "Documents", "[[slug]] — what it covers")`) or from
  another document. The write result tells you `unresolvedLinks` (slugs that do not exist yet:
  write them or fix the name) and `orphan: true` (nothing links here yet: fix that, or nobody finds it).
- Point at repo files by path; never paste code that lives in git.
- Absolute dates, no pronouns, no secrets, no credentialed URLs (the daemon rejects those).

## Reading

Start from `PROJECT.md`'s Documents section or `weave_knowledge_docs`, open with
`weave_knowledge_doc_get`, and follow `linksTo` as deep as the question needs. `linkedFrom` tells
you who depends on a page before you change it.

## Curation

Documents count toward curation like hub entries. A curation turn may merge two documents,
split one that is over budget, fix broken links, and delete a page that is only history; every
deletion is archived first. Never add a fact during curation.
