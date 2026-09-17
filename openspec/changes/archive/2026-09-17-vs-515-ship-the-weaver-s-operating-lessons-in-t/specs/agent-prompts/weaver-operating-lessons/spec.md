## Purpose

Defines the operating lessons the shipped weaver instructions must carry — preferring the delivery
to the claim, routing a human message as one act, and reading worker state before acting — so that
every deployment's weaver learns them from the product rather than from one deployment's private
runtime notes. (The worker-option lesson is deliberately not carried here: the code enforces it and
its shipped text already explains how to choose, so this capability does not duplicate it.)

## ADDED Requirements

### Requirement: The shipped weaver instructions prefer reading the delivery to accepting a claim

The always-loaded weaver instruction template and the weaver skill SHALL each state that a plan or
report asserting that something works is not evidence that it does, and that the weaver reads the
delivery itself before treating it as done. They SHALL state that rendered evidence for a visual
change means the rendered output across the supported themes and viewport sizes, opened and
confirmed rather than asserted. They SHALL state that a pull request is not ready to call while its
checks are still running.

#### Scenario: The delivery is read, not the claim

- **WHEN** the shipped weaver instructions are read as source
- **THEN** they state that an assertion of success is not evidence and that the delivery is read
  before the work is treated as done

#### Scenario: Visual evidence means the renders

- **WHEN** the shipped weaver instructions are read as source
- **THEN** they state that visual evidence means the rendered output across the supported themes and
  viewport sizes, opened and confirmed

#### Scenario: A running check is not a ready pull request

- **WHEN** the shipped weaver instructions are read as source
- **THEN** they state that a pull request is not called ready while its checks are still running

### Requirement: The shipped weaver instructions route a human message as one act

The always-loaded weaver instruction template and the weaver skill SHALL each state that a stated
want is acted on rather than turned into a question, that asks which arrive together are one ticket
rather than one each, and that a message carrying a roadmap block is recorded as a roadmap item
rather than filed as a ticket.

#### Scenario: A stated want is acted on

- **WHEN** the shipped weaver instructions are read as source
- **THEN** they state that a human's stated want is acted on and is not turned into a poll

#### Scenario: Asks arriving together are one ticket

- **WHEN** the shipped weaver instructions are read as source
- **THEN** they state that asks arriving together belong in one ticket

#### Scenario: A block-carrying message is a roadmap item

- **WHEN** the shipped weaver instructions are read as source
- **THEN** they state that a message carrying a roadmap block is recorded as a roadmap item and not
  filed as a ticket

### Requirement: The shipped weaver instructions read worker state before acting

The always-loaded weaver instruction template and the weaver skill SHALL each state that a run which
succeeded with no wake scheduled is a stall whatever the digest label says, that a run is inspected
before it is relaunched, and that before relaunching the weaver checks whether the human has already
resumed the worker.

#### Scenario: A succeeded run with no wake is a stall

- **WHEN** the shipped weaver instructions are read as source
- **THEN** they state that a succeeded run with no scheduled wake is a stall regardless of the digest
  label

#### Scenario: Inspect before relaunch, and check for a human resume

- **WHEN** the shipped weaver instructions are read as source
- **THEN** they state that a run is inspected before relaunching and that the weaver checks whether
  the human already resumed the worker
