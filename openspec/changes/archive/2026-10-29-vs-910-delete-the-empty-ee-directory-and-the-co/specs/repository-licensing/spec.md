## Purpose

Defines what the repository's licence documents state about commercial licensing, so the repository does not advertise a tier that does not exist while the CLA keeps the right to create one.

## ADDED Requirements

### Requirement: No commercial directory is shipped
The repository SHALL NOT track an `ee/` directory or any commercial licence text, and no current document SHALL claim that a commercially licensed directory exists.

#### Scenario: Tracked files
- **WHEN** `git ls-files ee` is run
- **THEN** it prints nothing

### Requirement: The CLA relicensing grant does not depend on a path
`CLA.md` SHALL grant the Owner the right to license Contributions under any terms, including proprietary commercial licences, without naming a directory.

#### Scenario: Grant wording
- **WHEN** a reader opens section 4 of `CLA.md`
- **THEN** it grants relicensing under any terms including commercial ones and contains no reference to `ee/`

### Requirement: Contributors are told about possible commercial relicensing
`README.md` and `CONTRIBUTING.md` SHALL state that submitting a contribution accepts `CLA.md`, which lets the project relicense the work, including under commercial terms.

#### Scenario: Contributor-facing pages
- **WHEN** a prospective contributor reads either page
- **THEN** they are told the work may be relicensed commercially
