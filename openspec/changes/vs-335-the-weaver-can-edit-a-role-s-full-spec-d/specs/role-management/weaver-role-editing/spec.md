## Purpose

Lets the weaver maintain a role completely — its short description, scope, responsibilities and the
rest — from the control plane, instead of only its charter prose. A spec edit is a normal role
revision, a security-sensitive permission change follows the hire policy and waits for approval, and
a spec-rendered charter and the live workers' briefs stay in step with what the role now says.

## ADDED Requirements

### Requirement: A weaver-only tool edits a role's spec fields

The system SHALL expose a weaver-only tool that updates the mutable fields of a role's spec —
`name`, `title`, `icon`, `charterSummary`, `scope`, `responsibilities`, `capabilities`, `exclusions`,
`rules`, `sessionPolicy`, `permission` and `notes` — by applying a partial patch to the named role
through the same service write the HTTP `PATCH /roles/:id` route uses. The tool SHALL be named in the
weaver tool surface and SHALL NOT be available to a worker. It SHALL require the role id, the patch
and a non-empty reason. It SHALL be a new revision of the role, with `changedKeys` recording exactly
the fields whose value changed, and it SHALL emit `role.updated`. It SHALL return the updated role,
the `changedKeys`, whether a spec-rendered charter was rewritten and how many live workers were
re-briefed.

#### Scenario: A stale description is corrected

- **WHEN** the weaver calls the tool with a patch that changes `charterSummary` and `scope`
- **THEN** the role's stored spec carries the new values
- **AND** a new role revision is written whose `changedKeys` are exactly `charterSummary` and `scope`
- **AND** `role.updated` is emitted

#### Scenario: A worker cannot call the tool

- **WHEN** a worker calls the tool by name
- **THEN** the call fails as forbidden

#### Scenario: An empty patch changes nothing

- **WHEN** the weaver calls the tool with no fields in the patch
- **THEN** the call fails as a validation error and no revision is written

### Requirement: Immutable and separately-owned fields are refused

A patch that names `id` or `project` SHALL be refused with a validation error naming them
immutable. A patch that names `secrets` or `maxWorkers` SHALL be refused with a validation error
naming `weave_role_set_secrets` or `weave_role_set_max_workers` respectively, so those fields keep
their own validation. A patch carrying a key that is not a role spec field SHALL be refused as a
validation error rather than silently stripped.

#### Scenario: The id cannot be changed

- **WHEN** the weaver calls the tool with `id` or `project` in the patch
- **THEN** the call fails as a validation error, nothing is written, and no revision is created

#### Scenario: Secrets and max workers are routed to their own tools

- **WHEN** the weaver calls the tool with `secrets` or `maxWorkers` in the patch
- **THEN** the call fails as a validation error and the message names the tool that owns that field

#### Scenario: An unknown key is refused, not stripped

- **WHEN** the weaver calls the tool with a patch key that is not a role spec field
- **THEN** the call fails as a validation error rather than reporting a successful no-op

### Requirement: A permission change follows the hire policy

A patch that changes `permission` — its `mode`, `allowed` or `denied` — SHALL NOT apply directly
unless the workspace's `hireApproval` default is `none`. With any other `hireApproval` value it SHALL
raise the same approval a hire raises, owned per that policy, carrying the whole patch, and SHALL
leave the role unchanged until the decision is answered `approve`. On approval the patch SHALL be
applied as a normal role revision; on `reject` nothing SHALL change. A patch that does not touch
`permission` SHALL apply immediately with a revision. The approval's card SHALL be presented as an
approval of the role change rather than as a hire, so its action does not read as hiring an existing
role.

#### Scenario: A permission change waits for a human when hireApproval is human

- **WHEN** `hireApproval` is `human` and the weaver calls the tool with a changed `permission`
- **THEN** a human-owned approval decision is raised carrying the patch
- **AND** the role's stored permission is unchanged while the decision is open
- **AND** the tool result reports the change as pending with the decision id

#### Scenario: Approval applies the patch

- **WHEN** the human answers that decision `approve`
- **THEN** the role's permission is updated and a role revision records the change

#### Scenario: Rejection changes nothing

- **WHEN** the human answers that decision `reject`
- **THEN** the role's permission is unchanged and no revision for the patch is written

#### Scenario: A permission change applies directly when hireApproval is none

- **WHEN** `hireApproval` is `none` and the weaver calls the tool with a changed `permission`
- **THEN** the change is applied immediately as a role revision, with no decision raised

#### Scenario: A non-permission patch applies immediately

- **WHEN** the weaver calls the tool with only fields other than `permission`
- **THEN** the change is applied immediately as a role revision, with no decision raised

### Requirement: applyToRunning re-briefs a role's live workers

When the caller sets `applyToRunning`, the system SHALL re-render the brief of every live worker of
the role from the updated spec and SHALL report how many workers were re-briefed. When it is not set,
the role change SHALL still reach a worker on its next turn through the existing spec-revision
refresh; only the immediate re-render is gated by the flag.

#### Scenario: Live workers are re-briefed on request

- **WHEN** a role has a live worker and the weaver calls the tool with `applyToRunning: true`
- **THEN** that worker's rendered brief reflects the new spec, and the tool result reports it was
  re-briefed

#### Scenario: Without the flag no worker is re-briefed immediately

- **WHEN** the weaver calls the tool without `applyToRunning`
- **THEN** the tool result reports no worker re-briefed, and the worker's brief refreshes on its next
  turn as before

### Requirement: A spec-rendered charter is refreshed, a hand-written one is left alone

When a spec change is written, the system SHALL refresh the role's `CHARTER.md` if and only if the
file's current content is what the spec template would render for the spec being replaced — that is,
the daemon generated it. A charter written by hand through `weave_role_update_charter` SHALL NOT be
overwritten by a spec change. The tool result SHALL say whether the charter was rewritten, so a
caller that expected the prose to move knows to update it with the charter tool.

#### Scenario: A spec-rendered charter is kept in sync

- **WHEN** a role's charter was rendered from the spec template and the weaver changes the spec
- **THEN** `CHARTER.md` is re-rendered from the new spec

#### Scenario: A hand-written charter is untouched and reported

- **WHEN** a role's charter was written by hand and the weaver changes the spec
- **THEN** `CHARTER.md` is left exactly as it was
- **AND** the tool result says the charter was not changed

### Requirement: The weaver instructions name the tool and split the two edits

The weaver's installed instructions SHALL name the spec-editing tool as the way to fix a stale
description, scope, responsibilities or other spec field, and SHALL keep the charter tool as the way
to change the charter prose, so the weaver reaches for the right one.

#### Scenario: The weaver reads how to fix a stale role description

- **WHEN** the weaver instructions are rendered
- **THEN** they name the spec-editing tool for a description or scope change and the charter tool for
  the charter prose
