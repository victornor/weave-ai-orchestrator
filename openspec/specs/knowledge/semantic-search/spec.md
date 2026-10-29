# knowledge/semantic-search Specification

## Purpose
An opt-in, agent-invoked semantic fallback over the knowledge base: a local embedding index, derived from the existing knowledge tree and scoped exactly like the existing keyword search, for finding an entry when the agent knows roughly what it wants but not the words the note used.

## Requirements

### Requirement: Semantic search is an opt-in tool alongside keyword search

`weave_knowledge_semantic_search(query, limit?)` SHALL be registered as an agent tool and SHALL return ranked knowledge hits, each naming the file it came from, its scope and project, its section where it belongs to one, a text excerpt, and a similarity score. Keyword search SHALL remain available and unchanged.

The capability SHALL NOT participate in the per-turn injection path: the inline knowledge slice and the bootstrap digest SHALL contain exactly what they contain without this capability, and a turn that does not call the tool SHALL perform no embedding work.

#### Scenario: Calling the tool returns ranked hits

- **WHEN** an agent calls `weave_knowledge_semantic_search` with a query and a limit
- **THEN** it receives at most `limit` hits, ordered by similarity, each naming the source file and the matched text

#### Scenario: A turn that does not call it is unchanged

- **WHEN** a turn's prompt and bootstrap digest are built with the capability present but the tool uncalled
- **THEN** both are identical to the same turn without the capability, and no model is loaded and no embedding is computed

### Requirement: Semantic search is scoped exactly as keyword search

A worker's semantic search SHALL return only knowledge that worker may read through the keyword search: its own project's knowledge and shared knowledge, and SHALL NOT return another project's knowledge or workspace-only knowledge (`workspace/WORKSPACE.md`, `workspace/decisions.md`, workspace-scoped documents). The weaver's semantic search SHALL reach the whole workspace. The same visibility rule SHALL govern both search tools, so the two cannot drift apart.

#### Scenario: A worker cannot reach another project's knowledge

- **WHEN** a worker calls `weave_knowledge_semantic_search` with a query that most closely matches an entry in another project's knowledge base
- **THEN** that entry is not returned, even when it is the nearest match in the workspace

#### Scenario: A worker cannot reach workspace-only knowledge

- **WHEN** a worker calls `weave_knowledge_semantic_search` with a query that most closely matches an entry in `WORKSPACE.md`, the decisions log, or a workspace-scoped document
- **THEN** that entry is not returned

#### Scenario: The weaver reaches everything

- **WHEN** the weaver calls `weave_knowledge_semantic_search` with the same queries
- **THEN** the workspace-only and other-project entries are returned

### Requirement: The embedding model is local, in-process and offline at query time

The embedding model SHALL run inside the daemon process, with no server, no sidecar process, no separate database and no approximate-nearest-neighbour index. Vectors SHALL be stored in the existing workspace SQLite database, on the connection the rest of the schema already uses, and compared by brute-force cosine similarity. A search SHALL NOT require an API key and SHALL NOT make a network call once the model weights are cached; the model weights are downloaded from the Hugging Face Hub on first use and cached outside the release directory.

#### Scenario: A search on a machine with cached weights and no network

- **WHEN** the weights are already cached and the machine has no network, and an agent calls `weave_knowledge_semantic_search`
- **THEN** the search completes and returns hits without any network access or API key

#### Scenario: No new storage service

- **WHEN** the capability is present
- **THEN** the vectors live in the existing workspace database file and no vector-database or ANN dependency is introduced

### Requirement: The index is content-hash keyed and incrementally maintained

Embeddings SHALL be keyed on a hash of the exact content embedded. Re-running the pipeline over unchanged content SHALL perform no re-embedding; editing one entry SHALL re-embed exactly that entry and no other; content that is removed SHALL have its embedding removed. The backfill over an existing knowledge tree SHALL be idempotent and SHALL report how many items it embedded, skipped and removed.

#### Scenario: Unchanged content is not re-embedded

- **WHEN** the pipeline is run twice over a knowledge tree whose content has not changed
- **THEN** the second run embeds nothing and changes no stored embedding

#### Scenario: An edit re-embeds exactly the edited entry

- **WHEN** one entry in a knowledge file is edited and the pipeline is run again
- **THEN** exactly the edited entry's embedding is recomputed, every other stored embedding is unchanged, and the backfill reports one item embedded

#### Scenario: A backfill reports what it did

- **WHEN** the backfill runs over the existing knowledge tree
- **THEN** it is idempotent and returns how many items it embedded, skipped and removed

### Requirement: The daemon degrades to keyword search when the model or extension cannot load

The model and the SQLite extension SHALL be loaded lazily, guarded. A load failure SHALL NOT prevent the daemon from starting and SHALL NOT disable keyword search; it SHALL be logged with a clear reason, and a semantic search SHALL fail with an error whose message names `weave_knowledge_search` as the way to search instead. Neither the model nor the extension SHALL be touched by daemon start-up or by a turn that does not call the tool.

A failure to load the embedding model SHALL NOT be treated as permanent: the next semantic search after a bounded cooldown SHALL retry the load, so a transient download or copy failure heals without a daemon restart. Attempts SHALL back off, never retry on every call, and a successful recovery SHALL be logged. A failure to load the SQLite extension MAY stay latched until restart, because a native module that is absent cannot appear at runtime.

#### Scenario: The model cannot be loaded now but can later

- **WHEN** the model weights are unavailable on one call (for example a failed first download) and become available before a later call
- **THEN** the first call fails with an error naming `weave_knowledge_search`, and a call after the retry cooldown loads the model and returns hits without a daemon restart

#### Scenario: A retry does not happen on every call

- **WHEN** a semantic search fails to load the model and another semantic search is made before the cooldown has elapsed
- **THEN** the second call returns the same failure without attempting the load again or downloading anything

#### Scenario: The model cannot be loaded

- **WHEN** the model weights are unavailable (no cache and no network) and an agent calls `weave_knowledge_semantic_search`
- **THEN** the daemon remains up, keyword search still works, a log line records the underlying reason, and the tool returns an error naming `weave_knowledge_search`

#### Scenario: The extension cannot be loaded

- **WHEN** the SQLite extension fails to load and an agent calls `weave_knowledge_semantic_search`
- **THEN** the daemon remains up, keyword search still works, one clear log line records the reason, and the tool returns an error naming `weave_knowledge_search`

#### Scenario: A daemon that never calls the tool never loads either

- **WHEN** the daemon starts and a turn does not call the tool
- **THEN** neither the model nor the extension is loaded

### Requirement: Keyword search shows whether semantic search is available

`weave_knowledge_search` SHALL return its hits together with the semantic index status, so that a caller which falls back to keyword matching can tell that it did and can report it. The result SHALL be an object with `hits`, the same ranked hits as before, and `semantic`, carrying a `status` of `ready`, `unavailable` or `not_loaded` and, when the status is `unavailable`, a `reason` naming the load failure. Reading this status SHALL NOT load the model, download anything or compute an embedding.

#### Scenario: A keyword search after a failed model load says semantic search is unavailable

- **WHEN** the semantic index has failed to load and an agent calls `weave_knowledge_search`
- **THEN** the result contains its hits and `semantic.status` is `unavailable` with the load failure in `semantic.reason`

#### Scenario: A keyword search on a daemon that never used semantic search does not load the model

- **WHEN** no semantic search has been attempted and an agent calls `weave_knowledge_search`
- **THEN** `semantic.status` is `not_loaded`, the hits are unchanged, and neither the model nor the SQLite extension is loaded

#### Scenario: A keyword search after a successful semantic search reports ready

- **WHEN** the model and extension have loaded successfully and an agent calls `weave_knowledge_search`
- **THEN** `semantic.status` is `ready`
