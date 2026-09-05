# knowledge/budgets Specification

## Purpose
Defines how much a knowledge file may hold: where the limit comes from, what the defaults are, how the workspace owner changes it, and what the daemon does as a file approaches and then crosses it — so that the memory carried between sessions is large enough to be useful and sized by the person who pays for the context it occupies.

## Requirements

### Requirement: A knowledge file's budget is a workspace setting

Every knowledge file SHALL have a token budget taken from the workspace configuration: one value for each hub file — the workspace knowledge base, the shared conventions, the decisions log, and a project knowledge base — and one value shared by every linked document.

The configured value SHALL be the one the daemon enforces and reports. No budget recorded when a file was first seen SHALL override it.

#### Scenario: A configured budget is enforced

- **WHEN** the workspace sets a project knowledge base budget and an entry is appended to a project knowledge base
- **THEN** the write is accepted or rejected against the configured value

#### Scenario: A file first seen under an earlier budget

- **WHEN** a knowledge file was first recorded while a different budget was in force
- **THEN** its budget is the currently configured one, not the one in force when it was recorded

### Requirement: Default budgets

A workspace that has not set a knowledge budget SHALL use these defaults, in tokens: project knowledge base **10000**, linked document **10000**, workspace knowledge base **10000**, decisions log **4000**, shared conventions **2000**.

A workspace that has set a value SHALL keep it. Upgrading the daemon SHALL NOT overwrite a budget the owner has set.

#### Scenario: A fresh workspace

- **WHEN** a workspace is created and no budget has been set
- **THEN** its project knowledge base and its linked documents each have a budget of 10000 tokens

#### Scenario: A workspace that already set a budget

- **WHEN** a workspace configuration sets an explicit budget for a scope
- **THEN** that value is used for that scope and the defaults apply to every other scope

### Requirement: A budget change takes effect on the next write

When the workspace owner changes a budget, the new value SHALL apply to the next knowledge read or write in that workspace. The daemon SHALL NOT require a restart, and no already-recorded knowledge SHALL be altered, truncated or archived because a budget changed.

#### Scenario: Raising a budget unblocks a write

- **WHEN** a knowledge file is over its budget and the owner raises that budget above the file's current size
- **THEN** the next entry appended to that file is accepted, with no restart

#### Scenario: Lowering a budget below a file's current size

- **WHEN** the owner sets a budget below the current size of an existing file
- **THEN** the file keeps its content, its next write is rejected as over budget, and a curation run is scheduled

### Requirement: The reported size is measured against the configured budget

Every path that reports a knowledge file's size SHALL report it against the configured budget: reading a knowledge base, listing or reading a linked document, the lint listing, and the events emitted when a file is written.

#### Scenario: Reading a knowledge base

- **WHEN** an agent or a client reads a knowledge base
- **THEN** the response carries the file's estimated size and the configured budget for its scope

#### Scenario: Listing linked documents

- **WHEN** linked documents are listed
- **THEN** each carries the configured document budget

### Requirement: An over-budget entry is rejected and curation is scheduled

An appended entry that would take a knowledge file past its configured budget SHALL be rejected. The rejection SHALL state the resulting size, the configured budget, and which sections are over their share of it, and it SHALL schedule a curation run for that file. The entry SHALL NOT be written.

A write that takes a file past 80 % of its configured budget without crossing it SHALL be accepted and SHALL schedule a curation run.

#### Scenario: An entry that does not fit

- **WHEN** appending an entry would take a knowledge file past its configured budget
- **THEN** the write is rejected with the size, the budget and the sections that are over, and a curation run is scheduled

#### Scenario: An entry that fits under a raised budget

- **WHEN** the same entry would have been rejected under the previous budget but fits under the configured one
- **THEN** it is written

### Requirement: A seeded knowledge file states the budget in force

A knowledge file the daemon creates SHALL state its budget in its own text, and that statement SHALL be the configured budget. When an existing file's text states a budget that is no longer the configured one, the daemon SHALL correct that statement the next time it writes the file, changing nothing else in the file.

#### Scenario: A newly seeded file

- **WHEN** the daemon seeds a knowledge file
- **THEN** the budget stated in the seeded text is the configured budget for that scope

#### Scenario: A file seeded under an earlier budget

- **WHEN** a file whose text states an out-of-date budget is next written
- **THEN** the stated budget is corrected and the rest of the file is unchanged

### Requirement: The owner sets budgets from the web app and from the CLI

The workspace settings screen SHALL let the owner see and change every knowledge budget, and the CLI SHALL let the owner change any workspace default, including the knowledge budgets, from the command line. A value that is not a positive whole number of tokens SHALL be rejected with a message naming the setting.

#### Scenario: Changing a budget from the settings screen

- **WHEN** the owner changes the project knowledge base budget on the workspace settings screen
- **THEN** the new value is persisted to the workspace configuration and is the one enforced from then on

#### Scenario: Changing a budget from the CLI

- **WHEN** the owner sets a knowledge budget with the CLI
- **THEN** the new value is persisted and reported back

#### Scenario: An invalid value

- **WHEN** a budget is set to zero, a negative number or a non-number
- **THEN** it is rejected and the stored configuration is unchanged

### Requirement: Changing one workspace setting leaves the others alone

Patching the workspace configuration SHALL change only the keys the patch carries. A setting nested inside a block SHALL NOT be reset to its default because a sibling key was patched. A list SHALL be replaced by the list in the patch rather than merged element by element.

#### Scenario: Patching one nested default

- **WHEN** a client patches a single value inside a block of workspace defaults
- **THEN** every other value in that block keeps the value it had

#### Scenario: Patching a list

- **WHEN** a client patches a configuration key whose value is a list
- **THEN** the stored list is the one in the patch

### Requirement: A worker's bootstrap digest fits a full-size knowledge base

The knowledge injected into an agent on its first turn SHALL fit within its own budget without truncation when every knowledge base it is given is at its configured budget. The digest budget SHALL be a workspace setting, and its default SHALL be large enough for the default knowledge budgets.

#### Scenario: A worker bootstrapped from full-size knowledge bases

- **WHEN** a worker's first turn is prepared and both the shared conventions and its project knowledge base are at their configured budgets
- **THEN** the injected digest carries both in full and is not truncated

#### Scenario: A digest budget smaller than the knowledge it carries

- **WHEN** the digest budget is set below the size of the knowledge to inject
- **THEN** the digest is truncated as it is today and says so, rather than failing the turn
