# knowledge/document-folders Specification

## Purpose
Lets a linked knowledge document live at a folder path within its scope instead of always sitting
flat under `docs/`, while its `[[slug]]` identity — and everything that resolves by slug — keeps
working exactly as before, wherever the document is filed.

## Requirements

### Requirement: A document can be created inside a folder

`ac_knowledge_doc_put` (and its HTTP equivalent) SHALL accept an optional folder path alongside the
slug. When given, a new document SHALL be created at that folder within its scope, nested at least
two levels deep (for example `research/competitors`). When omitted, a new document SHALL be created
flat under the scope's `docs/`, exactly as before this change. A folder path SHALL be one or more
kebab-case segments (`a-z0-9-`, 2-64 characters each) separated by `/`, with no leading, trailing or
doubled `/` and no `.` or `..` segment; a folder path failing that shape SHALL be rejected as a
validation error.

#### Scenario: A document is created two folders deep

- **WHEN** a worker calls `ac_knowledge_doc_put` with slug `retry-policy`, no existing document of
  that slug, and folder `runbooks/incidents`
- **THEN** the document is created at `runbooks/incidents/retry-policy.md` within the caller's scope
  and reads back with that folder reported

#### Scenario: No folder behaves exactly as before

- **WHEN** a worker calls `ac_knowledge_doc_put` with no folder argument
- **THEN** the document is created flat under the scope's `docs/`, identically to today

#### Scenario: A malformed folder is rejected

- **WHEN** a worker calls `ac_knowledge_doc_put` with a folder value containing an uppercase letter,
  a `..` segment, or a leading/trailing/doubled `/`
- **THEN** the write is rejected as a validation error and no document is created or changed

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

### Requirement: A document can be moved to a different folder without breaking a link

A document already filed at one folder MAY be moved to another folder (or to no folder) within the
same scope and project. A move SHALL change only the document's stored path; every `[[slug]]` link
already pointing at that document, in either direction, SHALL continue to resolve correctly
immediately after the move, since links are addressed by slug and never carried a path.

#### Scenario: Moving a document preserves inbound links

- **WHEN** a document with existing backlinks is moved from one folder to another
- **THEN** every file that linked to it by `[[slug]]` before the move still resolves that link to the
  document at its new folder, and the backlink index still lists them

#### Scenario: Moving to an occupied slug is impossible by construction

- **WHEN** a document is moved to a folder
- **THEN** no distinct document of the same slug can already exist there, because slug uniqueness
  within the scope is enforced regardless of folder

#### Scenario: Moving a document that does not exist is rejected

- **WHEN** a move is requested for a slug that does not resolve to an existing document in the given
  scope and project
- **THEN** the move is rejected as not found and nothing on disk or in the index changes
