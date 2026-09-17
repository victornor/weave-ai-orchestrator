# planning-sessions/weaver-handoff Specification

## Purpose
Defines what happens when captain submits a draft plan: the weaver receives it as one structured
handoff and turns it into real tickets that faithfully carry the plan's ordering, dependencies, tiers
and roles — or says plainly when a draft could not be turned into a ticket.

## Requirements

### Requirement: Submitting a plan hands it to the weaver as a structured wake, not a chat message

Submitting a plan SHALL notify the weaver through a dedicated mechanism that carries the plan's
identity, distinguishable from an ordinary chat message. The weaver SHALL be able to read the full,
current state of the submitted plan through that notification.

#### Scenario: Submitting notifies the weaver

- **WHEN** captain submits a plan
- **THEN** the weaver is woken with a notification identifying that plan, distinct from any chat
  message a human could have typed

#### Scenario: The weaver reads the plan submitted to it

- **WHEN** the weaver acts on a plan-submitted notification
- **THEN** it can read every draft in that plan, including each one's dependencies, target role,
  effective tier and priority

### Requirement: A plan can be submitted only once, and cannot be edited after submission

Submitting a plan SHALL mark it as submitted and SHALL NOT be repeatable for the same plan. A
submitted plan's drafts SHALL NOT be further edited from the planning conversation.

#### Scenario: Submitting twice does nothing the second time

- **WHEN** a plan has already been submitted, and a second submit attempt is made against it
- **THEN** the plan is not submitted again and no second notification is sent to the weaver

#### Scenario: A submitted plan's drafts are frozen

- **WHEN** a plan has been submitted
- **THEN** its drafts can no longer be added, edited, removed or reordered from the planning
  conversation

### Requirement: Tickets are created in dependency order, with real blockers

The weaver SHALL create a real ticket for each draft in a submitted plan that does not already have
one, such that a draft with a dependency on another draft in the same plan results in a real ticket
that is blocked by the ticket created from — or already existing for — that other draft. A draft that
was already dispatched before submission (`planning-sessions/scout-dispatch`) already has a ticket and
SHALL NOT have a second one created for it; its existing ticket is used wherever another draft's
dependency names it. A draft's dependency SHALL NOT be lost, reordered incorrectly, or represented only
as descriptive text.

#### Scenario: A dependent draft's ticket is blocked by its dependency's ticket

- **WHEN** draft B depends on draft A in a submitted plan
- **THEN** the real ticket created from draft B is blocked by the real ticket created from draft A

#### Scenario: Independent drafts create independently

- **WHEN** two drafts in a submitted plan have no dependency between them
- **THEN** their real tickets are created with no blocking relationship between them

#### Scenario: An already-dispatched draft is not filed again

- **WHEN** a submitted plan contains a draft that was already dispatched before submission
- **THEN** ticket creation for the submission does not create a second ticket for that draft, and its
  existing ticket is what the plan's other created tickets treat as its blocker where named

### Requirement: The created ticket honours the plan's role, priority and effective tier

Each real ticket created from a draft SHALL be assigned the draft's target role and priority, and
SHALL run at the draft's effective tier — its tier override when one is set, otherwise its suggested
tier.

#### Scenario: A tier override is honoured

- **WHEN** a draft has a suggested tier of `standard` and a tier override of `deep`
- **THEN** the real ticket created from it runs at the `deep` tier

#### Scenario: No override falls back to the suggested tier

- **WHEN** a draft has a suggested tier of `quick` and no tier override
- **THEN** the real ticket created from it runs at the `quick` tier

### Requirement: A draft that cannot become a ticket is reported, not dropped

When a draft cannot be turned into a real ticket (for example, no role in the project matches its
target role), the weaver SHALL record that failure against the draft with a stated reason, rather than
silently omitting it, and SHALL continue creating tickets for the plan's remaining drafts.

#### Scenario: One unfulfillable draft does not block the rest of the plan

- **WHEN** a submitted plan has one draft whose target role does not exist in the project, and other
  drafts whose roles do exist
- **THEN** the drafts with existing roles get real tickets created, and the unfulfillable draft is
  recorded as failed with a stated reason

#### Scenario: A dependency on a failed draft is itself reported, not silently created without its blocker

- **WHEN** a draft depends on another draft that failed to become a ticket
- **THEN** the dependent draft is also recorded as failed, with a reason naming the missing dependency,
  rather than being created without the intended blocker

### Requirement: Each created ticket is linked back to the draft that produced it

After a real ticket is created from a draft, that draft SHALL be linked to the created ticket so that
the plan's draft list shows, for each drafted item, whether and which real ticket exists for it.

#### Scenario: A created ticket is visible from its draft

- **WHEN** a real ticket has been created from a draft
- **THEN** that draft shows a reference to the created ticket

### Requirement: The weaver reports the outcome of processing a submitted plan

After processing a submitted plan, the weaver SHALL communicate the outcome — which drafts became
tickets and which failed and why — through its own channel to captain.

#### Scenario: A processed plan's outcome is reported

- **WHEN** the weaver finishes creating tickets for every draft in a submitted plan
- **THEN** it reports the outcome, including any drafts that failed and why, in its own conversation
  with captain
