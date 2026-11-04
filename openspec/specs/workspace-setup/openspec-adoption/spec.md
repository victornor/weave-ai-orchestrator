# workspace-setup/openspec-adoption Specification

## Purpose
Defines what project setup guarantees about the primary clone when it commits and pushes the generated OpenSpec scaffold, so a rejected push never leaves the clone ahead of its remote.

## Requirements

### Requirement: A failed adoption push leaves no local commit
When the push of the OpenSpec adoption commit fails, project setup SHALL remove that commit from the primary clone, keep the generated files uncommitted, and SHALL report the clone as uncommitted only if the removal succeeded. This SHALL hold when the adoption commit is the repository's root commit.

#### Scenario: Push rejected against an empty remote
- **WHEN** a project with OpenSpec on is added from an empty remote and the push of the adoption commit is rejected
- **THEN** the primary clone's branch has no commits, the scaffold files remain in the working tree, and no later fetch can make the project read `diverged`

#### Scenario: Push rejected against a remote with history
- **WHEN** the push of the adoption commit is rejected and the remote already has commits
- **THEN** the clone's HEAD equals its pre-adoption HEAD and the scaffold files remain uncommitted

#### Scenario: The undo itself fails
- **WHEN** removing the adoption commit fails
- **THEN** setup logs an error stating the clone is ahead of origin and does not log that the files were left uncommitted
