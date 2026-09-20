# plan-artifacts/storage Specification

## Purpose
Lets the planning agent publish a self-contained HTML artifact — a diagram, comparison table,
dependency view or mock of the intended change — against its own draft plan, so captain can see a
plan visualized the same way a worker shows a ticket, without the planner gaining any write access to
the project or repository.

## Requirements

### Requirement: The planner publishes a plan artifact with one tool call

A tool SHALL let the planning agent store a single HTML document against its own plan under a
caller-chosen key, returning a stable viewer URL and the resulting revision number, with no further
action required for the artifact to be attached to the plan. The tool SHALL act only on the plan the
calling agent's own session belongs to, and SHALL refuse any attempt to publish to another plan.

#### Scenario: First publish under a new key

- **WHEN** the planning agent publishes an HTML document under a key that has never been used on its
  plan
- **THEN** the call succeeds, returns a viewer URL and revision `1`, and the plan has one artifact
  under that key

#### Scenario: Publishing again under the same key

- **WHEN** the planning agent publishes a new HTML document under a key that already has a stored
  artifact on its plan
- **THEN** the call succeeds, returns the same viewer URL and an incremented revision number, the
  plan still has exactly one artifact for that key, and the earlier revision remains stored and
  retrievable by explicit revision number

#### Scenario: The planner cannot publish to another plan

- **WHEN** the planning agent attempts to publish an artifact against a plan other than the one its
  own session belongs to, or a non-planner caller attempts to publish to a plan
- **THEN** the call is refused and no artifact is created or modified

### Requirement: The stored body must be a single HTML document under the existing size cap

The publishing tool SHALL reject a body that is empty, is not recognizable as an HTML document,
exceeds the existing artifact size cap, or contains a malformed embedded base64 raster image, with an
error naming which condition failed. These are the same checks the ticket- and workspace-scoped
artifact tools already apply, and SHALL NOT be relaxed for a plan artifact.

#### Scenario: Empty or non-HTML body

- **WHEN** the planning agent submits an empty string, or a string with no HTML document markers
- **THEN** the call fails with a validation error describing the requirement, and no artifact
  revision is created or modified

#### Scenario: Oversized body

- **WHEN** the planning agent submits an HTML document larger than the artifact size cap
- **THEN** the call fails with a validation error naming the cap, and no artifact revision is created
  or modified

#### Scenario: Truncated embedded image is refused

- **WHEN** the planning agent submits HTML containing a data-URI image whose base64 is truncated or
  whose decoded raster bytes are incomplete
- **THEN** the call fails with a validation error identifying the malformed image, and no artifact
  revision is created

### Requirement: The planner can reach the artifact kit

The artifact-kit tool that returns the kit's CSS, token set, component description and playbook
reference material SHALL be reachable by the planning agent, so it can build a compliant artifact
from the tool result alone.

#### Scenario: The planning agent calls the kit tool

- **WHEN** the planning agent calls the artifact-kit tool with no arguments
- **THEN** it receives a successful result containing the kit's CSS, tokens, components and playbooks

### Requirement: A plan artifact is plan-scoped storage, never a repository or project write

Publishing or revising a plan artifact SHALL NOT create, transition or otherwise mutate a real
ticket, SHALL NOT write any file into the project's repository, and SHALL NOT change any project
setting. A plan artifact belongs to the plan, not to a ticket and not to the workspace's own artifact
store, and a plan's artifacts SHALL NOT be visible to another plan.

#### Scenario: Publishing creates no ticket and no repository change

- **WHEN** the planning agent publishes an artifact to its plan
- **THEN** no real ticket is created or changed, and no file in the project's repository changes

#### Scenario: Another plan's artifacts are not reachable

- **WHEN** an artifact key stored under one plan is requested or listed under a different plan's
  identifier
- **THEN** it is not returned, and the request fails as not found where a single artifact was named
