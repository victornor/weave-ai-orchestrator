## Purpose

The one shared rule that decides when a completed voice dictation is too short to insert, applied by
every dictation surface so a stray word is discarded but a deliberate short answer survives.

## ADDED Requirements

### Requirement: A dictation is discarded only below three words

A completed dictation SHALL be discarded when, and only when, its transcript holds fewer than three
words. A transcript of three words or more SHALL be inserted. A discarded transcript SHALL leave the
target field exactly as it was before the microphone opened — removing any interim words shown while
talking — SHALL start no insert animation, and SHALL submit nothing; when a send was queued or
armed, it SHALL be cleared and the human SHALL see the existing too-short notice rather than a sent
message.

Words SHALL be counted as whitespace-separated tokens that contain at least one letter or digit; a
punctuation-only token (`—`, `…`, `...`) is noise, not a word, and SHALL NOT count. The threshold
SHALL be one constant, shared by every dictation surface — both composers and the decision cards —
with no second threshold anywhere. The decision SHALL be taken over the whole session transcript and
applied when the session ends, not per result, so interim words still appear while the human talks.

#### Scenario: A three-word dictation is inserted

- **WHEN** a dictation session ends with a transcript of three words
- **THEN** the transcript is inserted into the target field and no too-short notice is shown

#### Scenario: A two-word dictation is discarded

- **WHEN** a dictation session ends with a transcript of two words
- **THEN** nothing is inserted, the field is restored to exactly what it held before the mic opened,
  and the human is shown the too-short notice

#### Scenario: Punctuation-only tokens are not words

- **WHEN** a transcript is one word plus punctuation-only tokens, so it holds fewer than three words
- **THEN** it is discarded, and a transcript holding three or more real words is inserted

#### Scenario: The rule is one constant for every surface

- **WHEN** the V1 composer, the V2 composer and a decision card each finish a dictation
- **THEN** each applies the same three-word minimum and no surface uses a different threshold

#### Scenario: A discarded transcript never sends

- **WHEN** a dictation was queued to send (or a send was armed) and its transcript is discarded for
  being too short
- **THEN** no message is submitted, the queued send is cleared, and the too-short notice is shown
