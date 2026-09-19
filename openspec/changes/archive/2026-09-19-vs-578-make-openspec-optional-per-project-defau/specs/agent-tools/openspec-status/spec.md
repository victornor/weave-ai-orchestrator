## MODIFIED Requirements

### Requirement: weave_openspec_status reports a host-tool failure

When the openspec binary cannot be executed — not found on the daemon's `PATH`, or present but
failing to run — `weave_openspec_status` SHALL return an error that names the real condition,
rather than a status object claiming the planning is incomplete with no artifacts. A ticket whose
change has no `openspec` directory SHALL still return the zeroed status. A ticket whose project's
OpenSpec mode is off and which is not bound to a change SHALL report that the mode is off for the
project, distinctly from a bound change with no planning yet.

#### Scenario: An unrunnable binary is an error

- **WHEN** `weave_openspec_status` is called for a ticket whose change exists but the openspec binary cannot be executed
- **THEN** the tool returns `ok: false` with an error naming the host-tool condition, not an empty plan

#### Scenario: A project without OpenSpec still returns a zeroed status

- **WHEN** `weave_openspec_status` is called for a ticket that is bound to a change whose `openspec` directory is absent
- **THEN** the tool returns the zeroed status with `planningComplete: false` and no error

#### Scenario: A project whose mode is off reports the mode

- **WHEN** `weave_openspec_status` is called for an unbound ticket whose project's OpenSpec mode is off
- **THEN** the returned status carries `enabled: false`, so a caller can tell it apart from a bound change that has not been planned

## ADDED Requirements

### Requirement: OpenSpec spec tools name the mode when it is off

For a project whose OpenSpec mode is off, `weave_spec_list`, `weave_spec_get`, `weave_spec_change_get`
and `weave_spec_search` SHALL return a typed `openspec_disabled` error naming OpenSpec as off for
that project, rather than an empty list, a `not_found`, or rows indexed before the mode was turned
off. A weaver search that names no project SHALL omit OpenSpec-off projects from its results rather
than failing.

#### Scenario: A spec read names the mode

- **WHEN** any of `weave_spec_list`, `weave_spec_get` or `weave_spec_change_get` is called for an OpenSpec-off project
- **THEN** the tool returns `ok: false` with code `openspec_disabled` and a message naming OpenSpec as off for that project

#### Scenario: A weaver search skips disabled projects

- **WHEN** `weave_spec_search` is called with no project by the weaver and some projects have their OpenSpec mode off
- **THEN** results from the OpenSpec-off projects are omitted and the call does not fail

#### Scenario: Rows from before the mode was turned off are not served

- **WHEN** a project that was indexed for OpenSpec has its mode turned off and a spec read is then made against it
- **THEN** the read returns `openspec_disabled` rather than the project's old capability or change rows
