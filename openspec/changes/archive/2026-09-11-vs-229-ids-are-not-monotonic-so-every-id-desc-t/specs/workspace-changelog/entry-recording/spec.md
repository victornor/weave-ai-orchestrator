## ADDED Requirements

### Requirement: Same-millisecond changelog entries page in a total order

Changelog paging SHALL treat `(created_at, id)` as a total order of recency, including two entries recorded in the same millisecond. Walking pages of size smaller than the same-millisecond group SHALL return each of those entries exactly once, newest-created first within that timestamp, with none repeated and none skipped.

#### Scenario: A same-millisecond group pages without repeat or skip

- **WHEN** four changelog entries share a timestamp and the caller loads them two at a time
- **THEN** the concatenated pages contain each of the four ids exactly once
- **AND** within that timestamp the ids appear in reverse creation order
