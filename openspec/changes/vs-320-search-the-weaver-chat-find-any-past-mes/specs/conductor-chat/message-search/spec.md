## Purpose

Defines full-text search over one weaver-chat thread's stored messages — not only the page currently
loaded in the browser — including how plain-text queries are made safe, how results are scoped and
ordered, and what a result shows.

## ADDED Requirements

### Requirement: Search runs over every stored message, not the loaded page

Searching a thread SHALL match against every message stored for that thread, regardless of how many
pages the client has loaded. A match on a message older than the client's currently loaded history
SHALL be returned.

#### Scenario: Match older than the first loaded page

- **WHEN** a thread holds more messages than the client has loaded, and a search term matches a
  message outside the loaded window
- **THEN** that message is returned as a result

### Requirement: Queries are plain text, never FTS5 syntax

A search query SHALL be treated as plain text. Characters that are meaningful full-text-search
operator syntax — quotes, `*`, `-`, `:`, parentheses, and similar — SHALL never cause a search to
error and SHALL never be interpreted as search operators.

#### Scenario: Operator characters in a query

- **WHEN** a search query contains `"`, `*`, `-`, `:`, `(`, or `)`
- **THEN** the search completes without error and treats those characters as ordinary text, not as
  search syntax

### Requirement: Search is scoped to one thread in one workspace

A search SHALL only return messages belonging to the requested thread, and that thread SHALL be
resolved within the caller's own workspace, enforced server-side. A thread id that does not belong to
the caller's workspace SHALL be treated as not found, the same as any other thread lookup.

#### Scenario: Cross-thread scoping

- **WHEN** a search is run against thread A with a query that matches a message in thread B
- **THEN** the message from thread B is not returned

#### Scenario: Cross-workspace scoping

- **WHEN** a thread id belonging to a different workspace is used to search
- **THEN** the search behaves as if that thread does not exist

### Requirement: Results are ordered, attributed, and previewed

Search results SHALL be ordered newest first. Each result SHALL show who wrote the matched message,
when it was written, and a snippet of the message body with the matching text highlighted. A search
with no matches SHALL produce a distinct, clearly empty result rather than an error or an
indistinguishable blank state.

#### Scenario: Multiple matches

- **WHEN** a query matches more than one message in a thread
- **THEN** the results are ordered from most recent to least recent, each with its author, timestamp,
  and a highlighted snippet

#### Scenario: No matches

- **WHEN** a query matches no message in the thread
- **THEN** the search reports a clear empty result

### Requirement: The index stays current from creation

Every message already stored in a thread at the time this capability ships SHALL be searchable. Every
message written after that — inbound or outbound — SHALL become searchable without any further
action.

#### Scenario: A pre-existing message is searchable

- **WHEN** a message was written before search was added
- **THEN** a query matching its text returns it as a result

#### Scenario: A new message is searchable immediately

- **WHEN** a new message is sent in a thread, inbound or outbound
- **THEN** a query matching its text returns it as a result without any separate reindexing step
