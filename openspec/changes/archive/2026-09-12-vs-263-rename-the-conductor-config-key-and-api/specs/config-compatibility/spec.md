## Purpose

Defines how the daemon reads a config file or a request body naming the agent kind under either its
old spelling (`conductor`) or its new one (`weaver`) after a source-level field rename, so an
existing `workspace.yaml`, `daemon.yaml`, or stored record never fails to parse and never silently
loses the setting it carries.

## ADDED Requirements

### Requirement: A renamed field is read under either spelling

For every field this capability governs, the system SHALL accept the field under its old name, its
new name, or neither (falling back to the field's default), and SHALL resolve it to the same value
regardless of which spelling was present.

#### Scenario: A file written before the rename still loads

- **WHEN** a `workspace.yaml` or `daemon.yaml` written before this capability existed is loaded, and
  it carries a governed field under its old name
- **THEN** the field is read exactly as if it had been written under the new name, and every other
  setting in the file is unaffected

#### Scenario: A file already written under the new name loads unchanged

- **WHEN** a config file carries a governed field under its new name
- **THEN** the field is read as given, with no dependency on the old name ever having existed

#### Scenario: Neither spelling is present

- **WHEN** a config file or request body omits a governed field entirely
- **THEN** the field resolves to its documented default, the same as before this capability existed

### Requirement: A response that persists nothing across a restart always uses the new spelling

Wherever the system reports a governed field's value in a response that is not itself written to
disk or to a database — an HTTP response body, a value returned to an in-process caller — it SHALL
report that field under its new name only, never its old one, regardless of which spelling the
underlying stored value arrived under.

#### Scenario: A models response reports the new spelling

- **WHEN** the system responds to a request for the current model settings, the daemon overlays, or
  the locked-control state
- **THEN** every governed field in that response is named under its new spelling, even when the
  workspace's or daemon's stored configuration still carries the field under its old spelling

### Requirement: A file or record that could still be read by prior code keeps its existing spelling on write, for now

For a governed field stored in an artifact that code predating this capability could still read — a
config file on disk, or a database record — the system SHALL write that field under whichever
spelling the artifact already carried before the write, rather than converting it to the new
spelling. An artifact that does not yet exist, or does not yet carry the field under either spelling,
SHALL be written under the field's pre-existing default spelling for that artifact type, not the new
one.

This is a deliberate, temporary exception, kept only for as long as code predating this capability
might still read the artifact after being restored (a rollback). It SHALL NOT be read as a permanent
policy, and lifting it — writing the new spelling once that concern no longer applies — SHALL NOT
require any change to how the field is read (the read side already accepts either spelling
unconditionally, per the requirement above).

#### Scenario: Saving a workspace's config preserves the existing spelling

- **WHEN** the daemon writes `workspace.yaml` (a settings change, an internal migration, or any other
  save) and the field being written was already present under its old spelling
- **THEN** the file on disk afterwards still carries that field under its old spelling, not the new
  one, even though the in-memory value and every response derived from it use the new spelling

#### Scenario: A file loaded under the old name is not rewritten as a side effect of loading

- **WHEN** a config file carrying a governed field under its old name is loaded but nothing about
  that load causes the system to write the file back
- **THEN** the file on disk is left exactly as it was, still under the old name, until something
  else causes the system to write it

#### Scenario: Prior code can still read a file this capability's code wrote

- **WHEN** a config file, or a stored policy record, is written by code that has this capability, and
  is later read by code that predates it (a rolled-back daemon)
- **THEN** every governed field in that file or record resolves to the same value the prior code
  would have resolved it to before this capability existed, because the bytes it wrote are exactly
  what the prior code already knew how to read

### Requirement: A field carrying both spellings at once is a refused, loud ambiguity

When a single config file, request body, or stored record carries a governed field under both its
old name and its new name at the same nesting level, the system SHALL refuse to silently prefer
either one. It SHALL fail validation with an error naming the field and both spellings, rather than
resolving to a value chosen by key ordering or any other implicit rule.

#### Scenario: A hand-edited file carries both spellings

- **WHEN** an operator's `workspace.yaml` or `daemon.yaml` carries a governed field under both its
  old and new name at the same level
- **THEN** loading that file fails with a validation error naming both spellings, and the daemon does
  not proceed with either value

#### Scenario: A request body carries both spellings

- **WHEN** a `PUT` request body governed by this capability carries a field under both its old and
  new name
- **THEN** the request is rejected with a validation error naming both spellings, and neither value
  is applied

### Requirement: A value, not only a key, may carry a legacy spelling

Where a governed field is a fixed value (an enum member) rather than a key name, the system SHALL
accept the field's old value on read and SHALL normalize it to the new value wherever it is used
in-process, with the same write behaviour as a renamed key: a response that persists nothing uses the
new value; a stored artifact that prior code could still read keeps writing the old value, for now.

#### Scenario: A role file carries the old creator value

- **WHEN** a role's stored spec carries `createdBy` set to the old value
- **THEN** it is read, and used in-process, as the new value; a later write of that role spec still
  carries the old value

#### Scenario: A project's stored policy carries the old approval-owner value

- **WHEN** a project's or workspace's approval-owner setting (who approves a proposal, a task, or a
  hire) was stored under the old value before this capability existed
- **THEN** it continues to be honored as the new value wherever it is read, without requiring every
  such record to be rewritten first

#### Scenario: A project's approval-owner policy keeps its existing spelling on write

- **WHEN** a project's or workspace's approval-owner setting is changed after this capability exists
- **THEN** the stored record carries the same spelling it already used (the old value), on the same
  terms as a config file, even though the value is read and used in-process as the new one
