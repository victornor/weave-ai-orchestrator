# incidents Specification

## Purpose
Twelve Weave AI incidents are still open (captain, 2026-09-18). Each is either a real control-plane or UI defect, already fixed by an earlier change without the incident being resolved, or obsolete. This change triages all twelve, fixes the real ones with a regression test, and resolves every incident with this ticket id (or a named follow-up), so none stays open without a reason.
## Requirements

### Requirement: A fix ticket accounts for every incident it was given
A ticket filed to fix a list of open incidents SHALL end with each listed incident either fixed with a regression test, or reported obsolete or unfixable with evidence, and each such incident SHALL be resolved with that ticket's id or carry a named follow-up ticket.

#### Scenario: Incident already fixed on main
- **WHEN** an incident's failure no longer reproduces on the ticket's base commit
- **THEN** the ticket report cites the commit or test that covers it, and the incident is resolved with the ticket id without a code change

#### Scenario: Incident cannot be fixed in the repository
- **WHEN** the cause lies outside the repository or needs the real coding CLI
- **THEN** the ticket report states why, marks the fact unverified, and the incident is resolved or given a named follow-up
