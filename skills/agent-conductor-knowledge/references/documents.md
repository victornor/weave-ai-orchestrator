# Linked documents

The hub files (`PROJECT.md`, `SHARED.md`, `WORKSPACE.md`) are budgeted summaries. Anything that
needs more than a few lines lives in a **document**: one topic page that links to other pages
with `[[slug]]`. Together they form the project's knowledge graph. Think Obsidian, with a budget.

| | Hub file | Document |
|---|---|---|
| Path | `knowledge/projects/<id>/PROJECT.md` | `knowledge/projects/<id>/docs/<slug>.md` |
| Write with | `ac_knowledge_note(scope, section, text)` | `ac_knowledge_doc_put(slug, body)` |
| Size | 1500 tokens for the whole file | 1500 tokens per document |
| Shape | fixed sections, ≤ 60-word entries | `# Title`, a one-line summary paragraph, then whatever the topic needs |
| Found through | always loaded at boot | `ac_knowledge_docs` (catalogue), links, `ac_knowledge_search` |

Shared documents (`knowledge/workspace/shared/<slug>.md`) are readable by every agent and written
by the conductor only. Workspace documents are the conductor's private notes.

## When to write a document

Write one when a future worker would otherwise re-discover the same thing: how a subsystem fits
together, how an integration authenticates and fails, a deployment or release runbook, the data
model of one bounded context, an environment and its quirks. One topic per document.

Do **not** write one for: task state (the ticket), anything the repo already documents (link to
the file instead), code walkthroughs that go stale with every PR, or secrets of any kind.

## Before writing

1. `ac_knowledge_docs` — read the catalogue. If a document on the topic exists, **update it**
   (`ac_knowledge_doc_get`, edit, `ac_knowledge_doc_put` with the same slug) instead of adding a
   near-duplicate.
2. `ac_knowledge_search("<topic>")` — the hub entries and other documents that touch it.

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
  `PROJECT.md`** (`ac_knowledge_note("project", "Documents", "[[slug]] — what it covers")`) or from
  another document. The write result tells you `unresolvedLinks` (slugs that do not exist yet:
  write them or fix the name) and `orphan: true` (nothing links here yet: fix that, or nobody finds it).
- Point at repo files by path; never paste code that lives in git.
- Absolute dates, no pronouns, no secrets, no credentialed URLs (the daemon rejects those).

## Reading

Start from `PROJECT.md`'s Documents section or `ac_knowledge_docs`, open with
`ac_knowledge_doc_get`, and follow `linksTo` as deep as the question needs. `linkedFrom` tells
you who depends on a page before you change it.

## Curation

Documents count toward curation like hub entries. A curation turn may merge two documents,
split one that is over budget, fix broken links, and delete a page that is only history; every
deletion is archived first. Never add a fact during curation.
