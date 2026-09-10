## MODIFIED Requirements

### Requirement: The inspection returns a compact, redacted transcript of the run

The inspection SHALL include a transcript of the run's recorded events, rendered compactly: assistant
text truncated per entry, a tool call and its result folded into a single line naming the tool, the
one thing it acted on and its outcome, tool output truncated, and phase markers, run lifecycle lines
and errors kept in full. Each entry SHALL carry the sequence number and timestamp of the event it
came from, so an entry can be located in the run.

A companion event a runtime adapter records for the same tool call — a duplicate result or
completion event carrying no information beyond what the call and its result already rendered —
SHALL fold into that same line rather than appearing as an additional, near-empty line. Nothing the
companion event carries that the folded line is missing (its output, an exit code, a duration) SHALL
be lost; it SHALL back-fill the line instead of duplicating it. Only a companion event with no
matching call in the returned window, and that itself carries something a reader could use, SHALL
render as its own line.

Every string that reaches the conductor SHALL be redacted with the same rules the system applies to
anything that reaches a screen. The inspection SHALL NOT expose anything the run engine did not
already record.

#### Scenario: A transcript of a working run

- **WHEN** the conductor inspects a run whose recorded events include assistant text, a tool call
  with its result, a phase marker and an error
- **THEN** the transcript folds the call and its result into one line, keeps the phase marker and
  the error in full, and carries a sequence number and a timestamp on every entry

#### Scenario: A secret in a tool result

- **WHEN** a recorded event carries a value the redaction rules recognise as a secret
- **THEN** that value does not appear in the transcript the conductor receives

#### Scenario: A tool call with a duplicate companion event

- **WHEN** a run's recorded events include a tool call, its result, and a further event the runtime
  adapter recorded for the same call carrying no information beyond what the folded line already
  shows
- **THEN** the transcript still shows one line for that call, and the companion event contributes no
  additional line

#### Scenario: A companion event that backfills a missing result

- **WHEN** a tool call's own result event is absent from the recorded window but a companion event
  for the same call carries output, a duration or an exit code
- **THEN** the transcript's one line for that call shows that information rather than leaving it
  pending or losing it
