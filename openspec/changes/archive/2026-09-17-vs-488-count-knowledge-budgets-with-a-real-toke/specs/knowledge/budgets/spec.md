## MODIFIED Requirements

### Requirement: The reported size is measured against the configured budget

Every path that reports a knowledge file's size SHALL report it against the configured budget: reading a knowledge base, listing or reading a linked document, the lint listing, and the events emitted when a file is written. The size SHALL be counted with the tokenizer defined by `knowledge/token-counting`, never estimated from the file's byte length, so the size, the budget it is compared with and the write that is rejected for exceeding it are all the same kind of number.

#### Scenario: Reading a knowledge base

- **WHEN** an agent or a client reads a knowledge base
- **THEN** the response carries the file's counted size and the configured budget for its scope

#### Scenario: Listing linked documents

- **WHEN** linked documents are listed
- **THEN** each carries the configured document budget

#### Scenario: A file first measured before counting existed

- **WHEN** a knowledge file whose recorded size was produced by the byte ratio is read or linted
- **THEN** the size reported for it is the count of its current content, not the recorded byte-ratio number
