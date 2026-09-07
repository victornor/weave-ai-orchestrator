## ADDED Requirements

### Requirement: A note can target an existing linked document instead of the hub

`ac_knowledge_note` (and its HTTP and CLI equivalents) SHALL accept an optional document slug. When
given, the entry SHALL be appended to that document's named section instead of the caller's hub file,
under the same rules as a hub append: at most 60 words, rejected as a near-duplicate against the
document's own entries, and rejected with the write refused when it would put the document over its
own configured budget, scheduling curation for that document's scope in that case exactly as an
over-budget hub write does.

#### Scenario: A worker appends to an existing document

- **WHEN** a worker calls `ac_knowledge_note` with a `doc` slug naming a document that exists in its
  project
- **THEN** the entry is appended to that document under the named section, dated, and the document's
  revision advances

#### Scenario: A near-duplicate is rejected against the document, not the hub

- **WHEN** a worker's `doc`-targeted note is a near-duplicate of an entry already in that document
- **THEN** the write is rejected as a duplicate entry, and the hub file is not consulted or changed

#### Scenario: An over-budget document write is rejected and schedules curation

- **WHEN** a `doc`-targeted note would put the target document over its configured budget
- **THEN** the write is rejected, the document is flagged for curation, and the hub file is unaffected

#### Scenario: A note with no `doc` behaves exactly as before

- **WHEN** a worker calls `ac_knowledge_note` without a `doc` slug
- **THEN** the entry is appended to the caller's hub file, identically to today

### Requirement: A document-targeted note requires the document to already exist

`ac_knowledge_note` SHALL NOT create a document. A `doc` slug naming a document that does not yet
exist in the caller's visible scope SHALL be rejected, naming `ac_knowledge_doc_put` as the way to
create it first.

#### Scenario: The named document does not exist

- **WHEN** a worker calls `ac_knowledge_note` with a `doc` slug that does not resolve to an existing
  document in its project or shared scope
- **THEN** the write is rejected as not found, and the error names `ac_knowledge_doc_put` as the way
  to create the document

### Requirement: Document targeting respects the same project and scope boundaries as reading a document

A `doc`-targeted note SHALL be subject to exactly the same visibility rule as reading that document:
a worker may target only a document in its own project or a shared document; the conductor may target
any document in any project.

#### Scenario: A worker cannot target another project's document

- **WHEN** a worker calls `ac_knowledge_note` with a `doc` slug and a project other than its own
- **THEN** the write is rejected as forbidden, identically to any other knowledge tool call naming
  another project
