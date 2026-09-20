# plan-artifacts Specification

## Purpose
Lets a project require, with an opt-in policy that defaults off, that every `change` ticket's plan
comes with a self-contained visual artifact — a diagram, comparison, sequence or mock — published
under a reserved key and enforced at the `proposed` gate on both the OpenSpec and fast paths. How
that artifact is shown on the plan approval card is specified in
`human-decisions/option-cards`.

## ADDED Requirements

### Requirement: A per-project policy requires a plan artifact, default off

A project SHALL carry a boolean policy, `policies.visualPlanArtifact`, defaulting to **off**. A
project that has never set it, or whose value is absent or malformed, SHALL be treated as off. When
it is on, every `change` ticket that begins planning under it SHALL be required to publish a plan
artifact before it can reach `proposed`. Turning it on SHALL affect only tickets that begin planning
afterwards; turning it off SHALL affect only tickets that begin planning afterwards. The policy
SHALL be readable and changeable after the project exists, through the project config file, the
`PATCH /projects/:id` route and the project CLI (`weave project set-policy`), like the other project
policies.

#### Scenario: A project that never set the policy is off

- **WHEN** a project has no `visualPlanArtifact` policy set and a `change` ticket is proposed
- **THEN** no plan artifact is required and the ticket is proposed exactly as before this policy existed

#### Scenario: The policy is persisted and read back

- **WHEN** the operator sets a project's `policies.visualPlanArtifact` to true through `PATCH /projects/:id` or `weave project set-policy`
- **THEN** a subsequent read of the project reports it true, and the project's config file carries it

#### Scenario: An absent or malformed value is off

- **WHEN** a project's `policies.visualPlanArtifact` is absent, or holds a value the schema does not accept
- **THEN** the daemon treats the policy as off and requires no plan artifact

### Requirement: A ticket's rule is fixed when it starts planning, never re-read live

Whether a `change` ticket must publish a plan artifact SHALL be decided once, when the ticket is
assigned and begins its plan, from the project's policy at that moment, and recorded on the ticket.
Changing the project's policy afterwards SHALL NOT change the rule of a ticket already created: a
ticket that began while the policy was off SHALL NOT be required to publish a plan artifact when the
policy is turned on, and a ticket that began while it was on SHALL keep the requirement after the
policy is turned off. A ticket created before this policy existed SHALL read as off. A ticket whose
kind is not `change` SHALL never require a plan artifact.

#### Scenario: A ticket started before the policy is turned on is not trapped

- **WHEN** a `change` ticket began planning while the policy was off, and the project's policy is then turned on, and the ticket requests `proposed`
- **THEN** the ticket is proposed without being required to publish a plan artifact

#### Scenario: A ticket started while on keeps its rule after the policy is turned off

- **WHEN** a `change` ticket began planning while the policy was on, and the project's policy is then turned off, and the ticket requests `proposed` without a plan artifact
- **THEN** the transition is refused, exactly as it would have been had the policy stayed on

#### Scenario: A task, scout, question or operational ticket is unaffected

- **WHEN** a project's policy is on and a `task`, `scout`, `question` or `operational` ticket moves through its phases
- **THEN** no plan artifact is ever required of it

### Requirement: When the rule is on, `proposed` requires a plan artifact on both paths

For a `change` ticket whose rule is on, the transition to `proposed` SHALL be refused with a clear
validation error naming the artifact-publishing tool and the reserved plan key, unless the ticket
carries a published plan artifact — a stored ticket document `artifact:plan` with a current revision,
which only the artifact-publishing tool can create. The requirement SHALL apply on both the OpenSpec
path (a ticket bound to a change) and the fast path (a `change` ticket on an OpenSpec-off project,
whose plan is its `approach` document), alongside — never instead of — the existing plan checks. The
ticket SHALL remain in its prior status on refusal.

#### Scenario: Refused on the OpenSpec path without a plan artifact

- **WHEN** a bound `change` ticket whose rule is on has valid OpenSpec planning but has published no `artifact:plan`, and requests `proposed`
- **THEN** the transition is refused with a validation error naming `weave_ticket_artifact_put` and the key `plan`, and the ticket stays `proposing`

#### Scenario: Refused on the fast path without a plan artifact

- **WHEN** a `change` ticket on an OpenSpec-off project whose rule is on has recorded its `approach` document but published no `artifact:plan`, and requests `proposed`
- **THEN** the transition is refused with the same validation error and the ticket stays `proposing`

#### Scenario: Accepted once the plan artifact is published

- **WHEN** such a ticket publishes an `artifact:plan` through the artifact-publishing tool and requests `proposed`
- **THEN** the transition succeeds and the plan-approval card is raised exactly as it is when the rule is off

#### Scenario: A link-only artifact work product does not satisfy the rule

- **WHEN** a ticket has a `type = 'artifact'` work product with no stored `artifact:plan` document
- **THEN** it does not satisfy the rule and the transition is refused

### Requirement: The plan artifact is published under the reserved `plan` key, and supports the plan

The worker SHALL publish the plan artifact with `weave_ticket_artifact_put` under the key `plan`,
which stores the ticket document `artifact:plan` and records the artifact work product. The existing
artifact trust rules SHALL be unchanged: the same sandboxed viewer, the same single-document
validation and size cap, no scripts with network or cookie access, and no agent read-back. The plan
artifact is additional content for the plan: it SHALL NOT replace the written plan, the plan
document, or the OpenSpec planning artifacts, and it SHALL NOT change plan approval itself.

#### Scenario: The plan artifact is stored under the reserved key

- **WHEN** a worker publishes its plan artifact with `weave_ticket_artifact_put` under key `plan`
- **THEN** the ticket carries a stored `artifact:plan` document and exactly one `artifact` work product for it, served through the existing sandboxed raw route

#### Scenario: The artifact is not a substitute for the written plan

- **WHEN** the rule is on and the worker publishes a plan artifact but does not record the plan its path requires (an `approach` document on the fast path, or a validating OpenSpec change on the OpenSpec path)
- **THEN** the `proposed` transition is still refused for the missing plan

### Requirement: Leaving the policy off changes nothing

For a project whose policy is off, and for every ticket created before the policy was turned on, the
daemon SHALL behave exactly as before this change: no plan artifact is required, no card renders one
because of this rule, and every existing artifact, approval and plan path is unchanged.

#### Scenario: A policy-off project is unaffected

- **WHEN** a `change` ticket on a project whose policy is off reaches `proposed` with no plan artifact
- **THEN** it is proposed with no gate error and no card change attributable to this rule
