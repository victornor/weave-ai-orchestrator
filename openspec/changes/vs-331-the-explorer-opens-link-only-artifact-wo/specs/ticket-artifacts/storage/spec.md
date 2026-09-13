## ADDED Requirements

### Requirement: Artifact work products are recorded only by the artifact-publishing path
The general-purpose work-product tool SHALL reject a request to record a work product of type
`artifact`, with an error naming the dedicated artifact-publishing tool as the correct path, and
SHALL create or modify nothing. Artifact work products SHALL be created only by the
artifact-publishing tool, which also stores the artifact document they describe, so every artifact
work product the general tool could once have produced is no longer possible.

#### Scenario: Recording an artifact through the general work-product tool
- **WHEN** an agent calls the general-purpose work-product tool with type `artifact`
- **THEN** the call fails with an error naming the artifact-publishing tool, and no work product is
  created

#### Scenario: Publishing through the artifact tool still records exactly one work product
- **WHEN** an agent publishes an artifact through the artifact-publishing tool
- **THEN** the ticket has one `artifact` work product for that key, backed by its stored document,
  exactly as before
