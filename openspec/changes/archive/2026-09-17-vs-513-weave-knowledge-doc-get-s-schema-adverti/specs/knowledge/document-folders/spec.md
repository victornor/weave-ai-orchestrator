## MODIFIED Requirements

### Requirement: A document's slug is unique within its scope regardless of folder

A document is addressed by slug, not by path: within a scope (and, for project documents, within a
project), at most one document may exist for a given slug at any time, across every folder combined.
Resolving a document by slug — `ac_knowledge_doc_get`, `ac_knowledge_note`'s `doc` targeting,
`[[slug]]` link resolution and the backlink index — SHALL find that document wherever its folder
places it, without the caller needing to know or supply the folder. The published input schema for
each agent-facing knowledge tool SHALL expose the same field names and requiredness that its public
handler accepts; in particular, `weave_knowledge_doc_get` SHALL require the document's `slug`.

#### Scenario: Writing to an existing slug updates it in place, ignoring a different folder

- **WHEN** a worker calls `ac_knowledge_doc_put` with a slug that already exists at some folder, and
  passes a different folder than the one it currently lives at
- **THEN** the existing document at its current folder is updated in place; the document is not moved
  and no second document is created

#### Scenario: A `[[slug]]` link resolves a document inside a folder

- **WHEN** any knowledge file in the same scope contains `[[slug]]` naming a document that lives inside
  a folder
- **THEN** the link resolves to that document's actual path exactly as it would if the document sat
  flat under `docs/`, and the backlink index lists the linking file under that document's backlinks

#### Scenario: Every existing document keeps resolving unmoved

- **WHEN** this change is deployed against a workspace whose documents all sit flat under `docs/` (the
  layout every document had before this change)
- **THEN** every one of those documents continues to be created, read, listed, linked to and appear in
  the catalogue exactly as before, with no manual move required

#### Scenario: A published knowledge schema can be used to read a document

- **WHEN** a caller obtains the published schema for `weave_knowledge_doc_get` and builds an input with
  a valid `slug` and its optional scope fields
- **THEN** the public tool boundary accepts the input and returns the addressed document; an input
  using an undeclared identifier such as `key` is rejected with a validation error naming the expected
  `slug` field

#### Scenario: The published schema agrees across the knowledge-tool family

- **WHEN** a caller obtains the published schemas for the knowledge tools and invokes each with valid
  input described by its schema
- **THEN** every call reaches its corresponding handler successfully, without a schema-only field
  mismatch between publication and dispatch
