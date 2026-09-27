## ADDED Requirements

### Requirement: A query with tokenizer-dropped punctuation matches literally

A search query containing a character the search index's tokenizer treats as a word separator (for
example `_`, `.`, `-`, `/`, `@`) SHALL only return messages whose body contains that query text
literally, as a case-insensitive substring — not merely messages containing the tokenized form of the
query with the separator characters removed. A plain query containing no such character SHALL continue
to match on tokenized words, unaffected. The result snippet for a literal match SHALL highlight the
literal matched text, not a tokenized approximation of it.

#### Scenario: A query with an underscore excludes a non-matching message

- **WHEN** a thread contains one message with the literal text `_password` and another message that
  contains only the word `password` with no underscore
- **THEN** searching `_password` returns only the message containing the literal text `_password`

#### Scenario: A plain word query is unaffected

- **WHEN** a thread contains a message containing the word `password`
- **THEN** searching `password` still returns that message, exactly as before this requirement existed

#### Scenario: The snippet highlights the literal match

- **WHEN** a query containing tokenizer-dropped punctuation matches a message
- **THEN** the result's snippet highlights the exact literal substring that matched, not just the word
  it contains
