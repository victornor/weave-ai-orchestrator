## MODIFIED Requirements

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

## ADDED Requirements

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
