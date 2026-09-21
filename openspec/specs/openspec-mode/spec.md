# openspec-mode Specification

## Purpose
Makes OpenSpec's propose → plan approval → apply → archive flow optional per project, defaulting on, and gives a `change` ticket a fast path — a short reviewed plan instead of four planning artifacts — when a project's mode is off.

## Requirements

### Requirement: OpenSpec is a per-project mode that defaults to on

Each project SHALL carry an OpenSpec mode, set from the project config key `openspec.enabled`, defaulting to **on**. A project that has never set it, and a project created with no choice, SHALL be on. Turning the mode off SHALL change only how that project's `change` tickets are run; OpenSpec support SHALL NOT be removed and a project that stays on SHALL behave exactly as it did before this change.

#### Scenario: A project that never set the mode is on

- **WHEN** a project exists that has no `openspec.enabled` key in its config and no stored value
- **THEN** the daemon treats it as OpenSpec-on: its `change` tickets get a change name and run the OpenSpec flow

#### Scenario: A newly created project defaults on

- **WHEN** a project is added without naming the OpenSpec mode
- **THEN** the project's mode is on

### Requirement: A change ticket's path is fixed by its own binding, not the project's live mode

A `change` ticket SHALL be on the OpenSpec path if and only if it is bound to an OpenSpec change name; a `change` ticket with no bound change name SHALL be on the fast path. Whether a ticket is bound SHALL be decided when the ticket is created or its worker is spawned, from the project's mode at that moment. Changing a project's mode SHALL NOT change the path of a ticket already created: a ticket bound while the mode was on SHALL keep its OpenSpec flow after the mode is turned off, and a ticket created while the mode was off SHALL NOT be required to produce a proposal, spec deltas or a change after the mode is turned back on.

#### Scenario: A ticket bound before the mode is turned off keeps its OpenSpec flow

- **WHEN** a `change` ticket already has a bound OpenSpec change name, and the project's mode is then turned off
- **THEN** that ticket continues to validate, propose and archive through OpenSpec

#### Scenario: A ticket created while off stays off after the mode is turned on

- **WHEN** a `change` ticket was created while its project's mode was off and has no bound change name, and the project's mode is then turned on
- **THEN** the ticket is not required to produce OpenSpec artifacts to be proposed or to reach merge

### Requirement: A change ticket on the fast path does not use OpenSpec

When a project's mode is off, a `change` ticket SHALL reach review and merge without a proposal, a design document, a spec delta, a tasks file, an OpenSpec validation, an OpenSpec change gate or an archive step. The ticket SHALL still pass through plan approval, still open a pull request, and still require merge approval exactly as an OpenSpec-on ticket does.

#### Scenario: A change ticket on an off project reaches merge without OpenSpec artifacts

- **WHEN** a `change` ticket on an OpenSpec-off project is worked to completion
- **THEN** it reaches `in_review` and `merging` with no OpenSpec change bound, no proposal/design/specs/tasks artifacts, no OpenSpec validation and no archive step, and no `openspec_validation_failed` gate error

#### Scenario: A fast-path ticket still needs its plan approved

- **WHEN** a `change` ticket on an OpenSpec-off project requests `proposed`
- **THEN** the daemon raises the same plan-approval decision it raises for an OpenSpec-on ticket, owned per the project's `proposalApproval` policy, and the ticket does not reach `approved` until that approval is granted or auto-granted by policy

### Requirement: The fast path replaces propose with one short plan document

On an OpenSpec-off project a `change` ticket's planning step SHALL be a single short plan written by the worker and recorded as a ticket document. When the worker requests `proposed`, the daemon SHALL require that document to be present and non-empty, and SHALL publish its content as the ticket's plan document — the artifact the plan-approval card targets and the Plan view renders. A request to `proposed` with no such document SHALL be refused with a validation error that names what is missing, and the fast path SHALL NOT produce more than one planning artifact.

#### Scenario: The recorded plan becomes the ticket's plan document

- **WHEN** a worker on an OpenSpec-off `change` ticket records a short plan document and requests `proposed`
- **THEN** the transition succeeds, the ticket's plan document holds that text, and a plan-approval card targets that revision

#### Scenario: A missing plan is refused

- **WHEN** a worker on an OpenSpec-off `change` ticket requests `proposed` without having recorded a non-empty plan document
- **THEN** the transition is refused with a validation error naming the missing plan, and the ticket stays `proposing`

#### Scenario: A revised fast-path plan is republished

- **WHEN** a worker revises its plan document while the ticket is still `proposed`
- **THEN** the daemon republishes the ticket's plan document and raises a fresh plan-approval card exactly as it does for a revised OpenSpec plan

### Requirement: The mode can be changed after a project exists

A project's OpenSpec mode SHALL be readable and changeable after the project exists, from the project settings UI, from the CLI, and through the project config. Turning it off SHALL take effect for tickets created afterwards; turning it on SHALL take effect for tickets created afterwards and SHALL NOT demand OpenSpec artifacts from tickets already created while it was off.

#### Scenario: The mode can be turned off from settings and read back

- **WHEN** the operator turns a project's OpenSpec mode off from the project settings UI
- **THEN** the change is persisted and a subsequent read of the project reports the mode off

#### Scenario: The mode can be turned off from the CLI

- **WHEN** the operator runs the project command that sets the OpenSpec mode to off
- **THEN** the change is persisted and `weave project show` reports the mode off

#### Scenario: Turning the mode on for an existing project does not retro-demand artifacts

- **WHEN** a project whose mode was off is turned on, and a `change` ticket created while it was off is then proposed
- **THEN** that ticket is accepted on the fast path and is not required to produce OpenSpec artifacts

### Requirement: OpenSpec-only tools report the mode instead of failing obscurely

`weave_openspec_status` for a ticket whose project is OpenSpec-off and whose ticket is not bound to a change SHALL report that OpenSpec is off for the project, distinguishable from a bound change with no planning yet. The `weave_spec_*` tools SHALL, for a project whose mode is off, return a typed error stating that OpenSpec is off for that project, rather than an empty list, a `not_found`, or stale rows from before the mode was turned off. The same `openspec_disabled` result SHALL be returned by the HTTP `/specs` routes for an OpenSpec-off project.

#### Scenario: weave_openspec_status says the mode is off

- **WHEN** `weave_openspec_status` is called for an unbound ticket whose project is OpenSpec-off
- **THEN** the result states the mode is off for the project and is not a zeroed change that looks like unfinished planning

#### Scenario: weave_spec_get names the mode

- **WHEN** `weave_spec_get` is called for a capability on an OpenSpec-off project
- **THEN** the tool returns a typed `openspec_disabled` error naming OpenSpec as off for that project, not `not_found`

#### Scenario: A disabled project's stale spec rows are not served

- **WHEN** a project that was previously indexed for OpenSpec has its mode turned off
- **THEN** the `weave_spec_*` tools and the `/specs` routes report OpenSpec is off for it rather than serving its old capability or change rows

### Requirement: OpenSpec-only views show an off state, not an empty one

The ticket UI SHALL NOT render an OpenSpec progress panel, an OpenSpec state chip or a spec-archive panel for a ticket that is not on the OpenSpec path. The knowledge Specs view SHALL, for an OpenSpec-off project, state that OpenSpec is off for that project rather than showing "no capabilities yet", and SHALL NOT offer links into specs that do not exist.

#### Scenario: An off-path ticket shows no empty OpenSpec panel

- **WHEN** the ticket page is opened for a fast-path `change` ticket on an OpenSpec-off project
- **THEN** no "OpenSpec · … · 0/0 tasks" panel and no OpenSpec state chip is rendered

#### Scenario: The Specs view says the mode is off

- **WHEN** the knowledge Specs view is opened for an OpenSpec-off project
- **THEN** it states OpenSpec is off for that project rather than presenting an empty capability list as if the project had no specs

### Requirement: The weaver is not warned about a host tool no project needs

The daemon's host-tool warnings surfaced to the weaver SHALL NOT report the `openspec` binary as missing when no live project has its OpenSpec mode on.

#### Scenario: No project needs OpenSpec

- **WHEN** every non-archived project has its OpenSpec mode off and the `openspec` binary is absent
- **THEN** the weaver's briefing carries no warning that the `openspec` host tool is missing

#### Scenario: A project needs OpenSpec

- **WHEN** at least one non-archived project has its OpenSpec mode on and the `openspec` binary is absent
- **THEN** the existing missing-host-tool warning is still surfaced

### Requirement: Shipped worker and weaver guidance reads the project's mode

The shipped worker skills and the shipped weaver skill SHALL state that OpenSpec is a per-project mode an agent can read, and the worker skill SHALL describe the fast path (a short plan document, then implement, then the pull request) for a `change` ticket when the mode is off. The rendered worker brief and worker `AGENTS.md` SHALL instruct a worker to run the OpenSpec propose/apply workflow only when the ticket is on the OpenSpec path, and SHALL instruct the fast path otherwise.

#### Scenario: The worker skill describes both modes

- **WHEN** the shipped worker skill is read as source
- **THEN** it states that OpenSpec is a project property and describes the fast path for a `change` ticket when the mode is off

#### Scenario: The weaver skill notes the mode

- **WHEN** the shipped weaver skill is read as source
- **THEN** it states that the OpenSpec mode is a per-project property the weaver can read

#### Scenario: A fast-path worker is not told to propose

- **WHEN** the daemon renders the worker brief or worker `AGENTS.md` for a `change` ticket on an OpenSpec-off project
- **THEN** the rendered guidance describes the short-plan fast path and does not instruct the worker to create an OpenSpec change or run the propose/apply workflow

### Requirement: OpenSpec-on projects are unchanged

For a project with its OpenSpec mode on, the existing flow SHALL be preserved exactly: a `change` ticket is bound to an OpenSpec change, the `proposed` transition validates it and rejects incomplete planning with `openspec_validation_failed`, the rendered plan is the proposal + tasks + design, and the merge archives the change.

#### Scenario: An on project still validates before proposed

- **WHEN** a `change` ticket on an OpenSpec-on project requests `proposed` with incomplete or invalid OpenSpec planning
- **THEN** the transition is rejected with `openspec_validation_failed` exactly as before this change

#### Scenario: An on project still archives on merge

- **WHEN** a bound `change` ticket on an OpenSpec-on project merges
- **THEN** its OpenSpec change is archived as before this change

### Requirement: The proposed gate reports a missing worker checkout as itself

When a `change` ticket requests `proposed` and the reason OpenSpec planning cannot be read is that the
ticket's live worker has no worktree (a null path, or a recorded directory that is absent), the
transition SHALL be refused with an issue stating that the worker has no worktree and that it is being
repaired. It SHALL NOT report the condition as incomplete planning, invalid planning artifacts, or an
`openspec validate` failure, because those describe a plan problem the worker cannot act on.

#### Scenario: A missing checkout is named, not blamed on the plan

- **WHEN** a bound `change` ticket whose live worker has no worktree requests `proposed`
- **THEN** the transition is refused with an issue saying the worker has no worktree and is being repaired, and the issue does not say planning is incomplete

#### Scenario: A genuine planning gap still reports planning

- **WHEN** a bound `change` ticket whose worker has a worktree requests `proposed` with incomplete artifacts
- **THEN** the refusal still reports that the planning is not complete, exactly as before
