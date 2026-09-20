## ADDED Requirements

### Requirement: A draft ticket may carry a short summary alongside its full description

A draft ticket SHALL optionally carry a short summary — a sentence or two, within the configured
character cap — stored separately from its full description. The description SHALL be unchanged when a
summary is set or cleared, and the summary SHALL NOT replace or truncate the description that becomes
the created ticket. When a draft has no summary, its collapsed card SHALL fall back to the first
sentence of the description, so every draft has a short form to show without one being authored. The
summary SHALL be editable by the same actor who may edit the draft, through the same add and update
paths.

#### Scenario: A summary is stored alongside the description

- **WHEN** a draft is added or updated with a short summary and a full description
- **THEN** the stored draft carries both, and reading the draft back returns the description verbatim
  and the summary as given

#### Scenario: Clearing the summary leaves the description intact

- **WHEN** a draft with a summary has its summary cleared
- **THEN** the stored draft has no summary and its description is unchanged

#### Scenario: A missing summary falls back to the description's first sentence

- **WHEN** a draft has no summary and a non-empty description
- **THEN** its short form is the first sentence of the description

#### Scenario: An over-long summary is refused

- **WHEN** a draft is added or updated with a summary longer than the configured cap
- **THEN** the call fails with a validation error naming the cap, and no draft is created or modified
