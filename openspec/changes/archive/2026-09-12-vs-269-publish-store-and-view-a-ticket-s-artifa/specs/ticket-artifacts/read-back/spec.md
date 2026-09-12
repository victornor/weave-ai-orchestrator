## Purpose
Guarantees that once an artifact is published, no agent — including the one that authored it — can
ever retrieve its HTML body through an ordinary tool call, which is what makes it safe to treat
artifacts as exempt from an agent's context budget and from prompt-injection concerns other ticket
documents don't carry.

## ADDED Requirements

### Requirement: An agent cannot read an artifact's body back
Any tool that reads a ticket document's body by key SHALL refuse when the key identifies a stored
artifact, regardless of which agent, run, or role is asking, and regardless of whether that agent
authored the artifact itself.

#### Scenario: Reading a known artifact key
- **WHEN** an agent calls the ordinary document-read tool with a key that identifies an existing
  artifact
- **THEN** the call fails without returning the document's body, and the error states that artifact
  bodies are not readable by agents and names the artifact-publishing tool as the way to revise one.

#### Scenario: The artifact's own author tries to re-read it
- **WHEN** the same agent that published an artifact later calls the ordinary document-read tool for
  that artifact's key, in the same or a later run
- **THEN** the call is refused identically to any other agent's attempt — authorship grants no
  read-back access.

### Requirement: Artifact keys are not exposed as a guessing side-channel
A tool's key-not-found guidance SHALL NOT reveal the existence or name of an artifact key.

#### Scenario: Guessing a wrong key on a ticket that has artifacts
- **WHEN** an agent calls the ordinary document-read tool with a key that does not exist, on a ticket
  that has one or more published artifacts
- **THEN** any list of existing keys offered as a hint excludes every artifact key.

### Requirement: Listing a ticket's documents never exposes an artifact's body
Whatever a ticket's document list or metadata surface returns to an agent SHALL contain no artifact
body content, for every document on the ticket including artifacts.

#### Scenario: Listing documents on a ticket with artifacts
- **WHEN** an agent obtains a ticket's document list or metadata
- **THEN** every entry, including any artifact, carries only metadata (such as key, revision, or
  update time) and never the document body.
