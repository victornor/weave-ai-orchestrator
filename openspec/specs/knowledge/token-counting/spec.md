# knowledge/token-counting Specification

## Purpose
`packages/shared/src/tokens.ts` defines the only token estimate in the system as `ceil(bytes / 3.5)`, and every knowledge budget, reported size, inline slice and bootstrap digest is built on it. A byte ratio is not a token count, and it is wrong in both directions: measured against this workspace's real hub files it overstates prose by 12–32% and understates code fences and markdown tables by 14–24%, so a file reported at 80% of budget may be well over, and a write may be rejected that would have fit. The VS-487 survey named this the foundational fix to make before any other knowledge-base work, because it changes what every other budget number means.
## Requirements

### Requirement: Every token count comes from a real tokenizer

Every token count the daemon uses to enforce a knowledge budget, report a knowledge file's size, bound an injected slice, or measure a bootstrap digest SHALL be produced by encoding the text with a real tokenizer, never by a fixed ratio of its byte length.

The encoding SHALL be named in code together with the reason it was chosen, including that agents run on several model families and that a single encoding is used deliberately so one file has one size for every reader. Where the chosen encoding is an approximation for a model family with no public tokenizer, the code SHALL say so rather than imply exactness.

#### Scenario: A measured count replaces the byte ratio

- **WHEN** a code fence, a markdown table and non-ASCII text are counted
- **THEN** each result is the tokenizer's encoding of that text, and the byte-ratio estimate for the same text is not used

#### Scenario: The same file has one size for every runtime

- **WHEN** a knowledge file's size is counted for an agent on any supported runtime
- **THEN** the count is the same encoding for every runtime, so the file reports one size no matter which agent asked

#### Scenario: The encoding choice is written down

- **WHEN** the counting code is read
- **THEN** it names the encoding, why that encoding was chosen over the alternatives, and that it is an approximation for model families whose tokenizer is not publicly available

### Requirement: Counting is synchronous and cached on the hot paths

The token counter SHALL return synchronously, and the encoder SHALL be created once, lazily, and reused, so repeated counting within a turn does not reload it. Counting a hub-sized knowledge file SHALL stay cheap enough to run on every turn that measures knowledge.

#### Scenario: The encoder is reused

- **WHEN** the counter is called more than once in a process
- **THEN** the same encoder instance is reused and no new encoder is created

#### Scenario: Counting a hub-sized file

- **WHEN** a knowledge file the size of a full hub is counted
- **THEN** the call returns synchronously without a perceptible delay to the turn

### Requirement: Text is bounded by tokens, not characters

Where the daemon cuts text to keep it within a token budget — the per-turn inline knowledge slice and the bootstrap digest's hard cap — the cut SHALL be made on the tokenizer's tokens, so the kept text is within the budget it was cut for. A character count derived from a token budget SHALL NOT be used to cut text.

#### Scenario: An inline knowledge slice over its budget

- **WHEN** the shared knowledge is longer than the inline knowledge budget
- **THEN** the text inlined into the prompt counts no more tokens than that budget at the chosen encoding

#### Scenario: A bootstrap digest over its budget after Learnings truncation

- **WHEN** a bootstrap digest is still over its budget after its Learnings section is truncated
- **THEN** the hard-capped digest counts no more tokens than the budget at the chosen encoding

### Requirement: Every stored or reported size is the corrected count

Every knowledge size the daemon stores or reports SHALL be the count produced by the tokenizer, including files first measured before this counting existed. A file whose recorded size was produced by the byte ratio SHALL be recomputed from its content rather than left stale, and no budget check, health figure, lint figure or curation verdict SHALL derive from a byte-ratio number.

#### Scenario: A write records the tokenizer's count

- **WHEN** a knowledge file is written
- **THEN** the size recorded for it is the tokenizer's count of the written text

#### Scenario: A file recorded under the old byte ratio

- **WHEN** a knowledge file whose recorded size was produced by the byte ratio is read, linted, reported in knowledge health, or swept for curation
- **THEN** the size it reports is the tokenizer's count of its current content, not the recorded byte-ratio number

#### Scenario: A budget rejection compares the corrected count

- **WHEN** an entry would take a file past its configured budget
- **THEN** the size compared against the budget is the tokenizer's count

### Requirement: A byte-ratio estimate survives nowhere

The daemon SHALL NOT keep a second, byte-based token estimate alongside the tokenizer, and SHALL NOT convert a token budget into a character count. Any caller that needs a bounded length SHALL ask the tokenizer for it.

#### Scenario: No character-conversion remains

- **WHEN** the code that enforces or reports a knowledge budget is searched for a byte-length-to-token or token-to-character conversion
- **THEN** none remains; every such path goes through the tokenizer

#### Scenario: A tokenizer failure is not hidden by a byte ratio

- **WHEN** the tokenizer cannot count some input
- **THEN** the daemon does not silently fall back to the byte ratio to produce a number that is then enforced as if it were a token count
