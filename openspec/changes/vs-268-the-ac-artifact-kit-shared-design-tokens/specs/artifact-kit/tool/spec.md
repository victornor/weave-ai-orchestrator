## Purpose

Lets an agent fetch the AC Artifact Kit and its reference material on demand, at the moment it is
producing an artifact, instead of paying for that content on every turn.

## ADDED Requirements

### Requirement: `ac_artifact_kit` is reachable by every agent
The system SHALL expose an `ac_artifact_kit` tool, callable with no input, reachable by both
conductor and worker agents through MCP and the agent REST mirror, requiring no additional
registration beyond the existing tool seam.

#### Scenario: A worker calls the tool
- **WHEN** a worker or conductor agent calls `ac_artifact_kit` with no arguments
- **THEN** it receives a successful result, with no project- or ticket-scoping restriction.

### Requirement: The tool returns the kit and its reference material
`ac_artifact_kit`'s result SHALL include the kit's CSS text, its token set, a description of its
semantic component classes, and the skill's playbook reference material, so an agent can build a
compliant artifact from the tool result alone.

#### Scenario: Building an artifact from the tool result
- **WHEN** an agent calls `ac_artifact_kit` and uses only the returned `css`, `tokens`, `components`
  and `playbooks` fields
- **THEN** it can produce an artifact that uses the AC Artifact Kit correctly without reading any
  other file.
