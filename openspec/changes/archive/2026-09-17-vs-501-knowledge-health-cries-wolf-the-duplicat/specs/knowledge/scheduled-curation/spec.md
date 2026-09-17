## MODIFIED Requirements

### Requirement: A bounded sweep surfaces near-duplicate entries without changing anything

The daemon SHALL periodically compare the existing entries within a scope with each other and
report pairs at or above the existing `DUPLICATE_THRESHOLD` of 0.8. The sweep SHALL use the existing
entry normalization and a comparison that requires meaningful shared content on both sides; a high
score SHALL NOT be awarded solely because a short entry is contained in a longer entry. The sweep
SHALL exclude entries with fewer than two words or fewer than 12 non-whitespace characters, and SHALL
exclude hub-file section-pointer lines whose text begins with a `[[slug]]` link and acts as a
one-line pointer to a linked document.

The sweep SHALL only report. It SHALL NOT edit, merge, archive or delete any entry, file or document.

The sweep SHALL be bounded: the number of entries it compares SHALL be capped at a fixed maximum, so
its cost is bounded by that cap and does not grow without limit as the corpus grows. A corpus larger
than the cap SHALL be swept up to it, and that the sweep was capped SHALL be visible in its output or
log rather than silent.

The minimum-content floor is deliberately the smallest floor that removes the reported one-word
`**Status:**` false positives while preserving the real two-word near-duplicate entries that the
knowledge system must still surface. The character floor prevents punctuation-only or similarly
contentless short variants from bypassing the word floor.

#### Scenario: Two entries that drifted together

- **WHEN** two existing entries within one scope pass the minimum-content and hub-pointer filters and are at or above the duplicate threshold
- **THEN** the pair is reported, naming both entries and the file each sits in

#### Scenario: A short boilerplate entry

- **WHEN** an entry contains only the real `**Status:**` boilerplate fragment from `workspace/docs/self-hosted-ci-runner.md`
- **THEN** it is not compared or reported as a duplicate of unrelated project prose

#### Scenario: A contained fragment and unrelated prose

- **WHEN** a short entry shares only a common word or short phrase with a longer unrelated entry
- **THEN** the pair is not reported solely because the shorter text is contained in the longer text

#### Scenario: A repeated hub section pointer

- **WHEN** a project hub contains the same `[[daemon-test-suite]] — ...` pointer in both `Landmines` and `Documents`
- **THEN** the pair is not reported as a duplicate

#### Scenario: A genuine near-duplicate remains visible

- **WHEN** two real knowledge entries state the same gateway retry fact with one entry adding only a trailing qualifier
- **THEN** the pair is reported with both entries and its score

#### Scenario: The sweep changes nothing

- **WHEN** the duplicate sweep runs
- **THEN** no knowledge file, entry or document is written, merged, archived or deleted, and the only output is the reported pairs

#### Scenario: A corpus larger than the cap

- **WHEN** a scope holds more entries than the sweep's cap
- **THEN** the sweep compares at most that many and reports that it was capped, rather than comparing every pair
