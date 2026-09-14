## REMOVED Requirements

### Requirement: The autonomy question maps to existing workspace settings
**Reason**: The third answer, "Let the weaver decide", wrote a workspace-wide `defaults.yolo`, which
granted automatic approvals to every project including ones added later. YOLO is now a per-project
setting with no workspace default.
**Migration**: "Ask me before any plan" and "Only merges and actions" keep writing
`defaults.proposalApproval`. "Let the weaver decide" now sets `policies.yolo: true` on the projects
added during onboarding, matching the Settings → Projects control.

## ADDED Requirements

### Requirement: The autonomy question maps to per-project autonomy

The autonomy question SHALL offer exactly three answers, matching the redesign: "Ask me before any
plan", "Only merges and actions", and "Let the weaver decide". None SHALL be pre-selected: because
"Let the weaver decide" grants the daemon both plan and merge approvals automatically, the human
SHALL choose explicitly. A line under the chips SHALL state what each answer does and that action
approvals always stay with the human.

The chosen answer SHALL persist only once creation has succeeded. "Ask me before any plan" and
"Only merges and actions" SHALL write `defaults.proposalApproval` on the new workspace through the
same configuration write Settings uses. "Let the weaver decide" SHALL NOT write any workspace
default; it SHALL set `policies.yolo: true` on each project added during this onboarding run, so the
autonomy it grants is scoped to those projects. When the run added no project, the answer SHALL
write nothing. The answer SHALL remain changeable later in Settings → Projects, and action approvals
SHALL never be granted by any of the three answers.

#### Scenario: Asking before any plan

- **WHEN** the human picks "Ask me before any plan"
- **THEN** on success the workspace's `proposalApproval` is the human, and no project has YOLO mode on

#### Scenario: Only merges and actions

- **WHEN** the human picks "Only merges and actions"
- **THEN** on success the workspace's `proposalApproval` is the weaver, and no project has YOLO mode on

#### Scenario: Letting the weaver decide

- **WHEN** the human picks "Let the weaver decide" and the run added projects
- **THEN** on success each project added by the run has `policies.yolo: true`, and no workspace-wide YOLO setting is written

#### Scenario: Letting the weaver decide with no projects

- **WHEN** the human picks "Let the weaver decide" and the run added no project
- **THEN** no approval setting is written

#### Scenario: Nothing is pre-selected

- **WHEN** the autonomy question is first shown
- **THEN** no chip is selected, and the explanatory line names each answer's effect

#### Scenario: A failed create writes nothing

- **WHEN** workspace creation does not succeed
- **THEN** no approval setting is written and no project is patched

#### Scenario: Action approvals stay with the human

- **WHEN** any of the three answers is chosen
- **THEN** action approvals continue to require the human
