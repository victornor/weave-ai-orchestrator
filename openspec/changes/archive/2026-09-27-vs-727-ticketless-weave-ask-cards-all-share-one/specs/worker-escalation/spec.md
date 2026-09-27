## ADDED Requirements

### Requirement: A ticketless ask gets its own bucket, not a shared workspace bucket

An ask raised with no ticket attached — the weaver's own ask to the human, or a ticketless
session's — SHALL NOT be superseded by, and SHALL NOT supersede, another open ticketless decision
unless both were raised with the same explicit `correlationKey`. Two ticketless asks of the same
kind and the same owner, with no explicit correlation key, SHALL both remain `open` regardless of
whether they name the same project, different projects, or no project at all. This holds for every
askable kind (`question`, `concern`, `gate_finding`) — the only kinds `weave_ask` can raise — and
regardless of which agent raises the ask.

A caller that wants a ticketless re-ask to replace an earlier open one on purpose SHALL do so by
passing the same explicit `correlationKey` on both asks; that pair SHALL still supersede.

The dedup a ticket-scoped ask relies on — a repeat ask of the same kind, by the same owner, on the
same ticket, superseding the earlier one with no explicit key — is unaffected by this requirement.

This requirement governs only the default correlation key for the three askable kinds. A
system-raised decision of any other kind (`retry_approval`, `hire_approval`, `merge_approval`,
`plan_approval`, `action_approval`, `discard_approval`, `promotion_approval`) is unaffected, whether
or not it carries a ticket: every such kind is raised only through call sites that already pass their
own explicit `correlationKey`, and this change does not alter the default those kinds would fall back
to if one ever omitted one.

#### Scenario: Two ticketless asks about different projects both stay open

- **WHEN** the weaver raises a ticketless `question` naming project Alpha, and then raises another
  ticketless `question` naming project Beta, neither passing an explicit `correlationKey`
- **THEN** both decisions are `open` at the same time and neither has superseded the other

#### Scenario: Two ticketless asks naming no project at all both stay open

- **WHEN** the weaver raises a ticketless `question` naming no project, and then raises another
  ticketless `question` naming no project, neither passing an explicit `correlationKey`
- **THEN** both decisions are `open` at the same time and neither has superseded the other

#### Scenario: An explicit shared correlation key still supersedes a ticketless ask

- **WHEN** the weaver raises a ticketless ask with an explicit `correlationKey`, and then raises
  another ticketless ask of the same kind and owner with that same explicit `correlationKey`
- **THEN** the earlier decision is `superseded` and the new one is `open`

#### Scenario: The fix applies to concern and gate_finding the same way it applies to question

- **WHEN** two ticketless `concern` asks, or two ticketless `gate_finding` asks, are raised by the
  same owner with no explicit `correlationKey` and no shared project
- **THEN** both decisions are `open` at the same time and neither has superseded the other

#### Scenario: A ticket-scoped repeat ask still supersedes

- **WHEN** the same owner raises a second decision of the same kind on the same ticket with no
  explicit `correlationKey`
- **THEN** the earlier `open` decision on that ticket is `superseded` and the new one is `open`,
  exactly as before this change

#### Scenario: A ticketless retry_approval still supersedes per agent, unaffected by this change

- **WHEN** a ticketless `retry_approval` is raised for one agent, and then another ticketless
  `retry_approval` is raised for the same agent
- **THEN** the earlier decision is `superseded` and the new one is `open`, exactly as today, because
  that call site's own explicit `correlationKey` is untouched by this requirement

#### Scenario: Ticketless retry_approvals for different agents do not collide

- **WHEN** a ticketless `retry_approval` is raised for one agent and a ticketless `retry_approval` is
  raised for a different agent
- **THEN** both decisions are `open` at the same time
