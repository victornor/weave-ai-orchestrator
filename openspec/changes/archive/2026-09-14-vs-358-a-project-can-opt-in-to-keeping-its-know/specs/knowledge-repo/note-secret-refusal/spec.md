## Purpose

Closes the gap where a knowledge note, unlike a knowledge document, could carry a secret-shaped string — a prerequisite for any knowledge content being allowed to reach a git repository, and worth closing everywhere regardless of that.

## ADDED Requirements

### Requirement: A knowledge note refuses secret-shaped content

Appending a knowledge note SHALL be refused when its text matches the same secret-shaped patterns (API-key-style tokens, a PEM private key block, a credentialed URL) that a knowledge document write already refuses. This applies in every project, whether or not it has opted in to a knowledge repository.

#### Scenario: A note carrying an API-key-shaped token

- **WHEN** a knowledge note's text contains a string shaped like a provider API key or access token
- **THEN** the write is refused and nothing is recorded

#### Scenario: A note carrying a credentialed URL

- **WHEN** a knowledge note's text contains a URL with embedded credentials
- **THEN** the write is refused and nothing is recorded

#### Scenario: A note carrying a private key block

- **WHEN** a knowledge note's text contains a PEM private key block
- **THEN** the write is refused and nothing is recorded

#### Scenario: An ordinary note is unaffected

- **WHEN** a knowledge note's text contains no secret-shaped pattern
- **THEN** the write proceeds exactly as before
