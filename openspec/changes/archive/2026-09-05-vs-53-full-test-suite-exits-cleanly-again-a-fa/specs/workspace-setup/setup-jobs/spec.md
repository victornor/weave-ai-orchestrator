## ADDED Requirements

### Requirement: The operation behind an immediate answer is contained

An operation that a request started and did not wait for SHALL be best-effort with respect to the
process running it. When it fails, the failure SHALL be recorded on the job and on the entity the job
acts on, and SHALL be logged, exactly as when the operation is awaited — and it SHALL NOT additionally
surface as an unhandled error or an unhandled rejection in the process, and SHALL NOT prevent another
operation from being started afterwards.

The blocking form of the same operation, which the caller does await, SHALL continue to raise the
failure to that caller.

#### Scenario: A detached add that fails raises nothing

- **WHEN** a project add that was answered immediately fails
- **THEN** the job is `failed` with its failing sub-step, the project is `error` with its error text,
  the failure is logged, and the process raises no unhandled error or rejection

#### Scenario: The awaited form still raises

- **WHEN** a project is added through the form that waits for the operation and it fails
- **THEN** the caller receives the failure, and the job and the project record it as they otherwise would
