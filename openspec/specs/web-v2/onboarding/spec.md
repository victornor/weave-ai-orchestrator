# web-v2/onboarding Specification

## Purpose
The V2 first-run flow: a conversational, five-step onboarding that drives the daemon's existing
workspace creation, model selection and project add, and lands the human in V2 — including the
autonomy question the redesign draws, mapped onto existing workspace settings.

## Requirements

### Requirement: V2 onboarding is a five-step conversation

The V2 app SHALL render first-run onboarding at `/v2/onboarding` as a chat-like, stepped flow rather
than a column of fields, styled with the V2 (Mono) tokens in both themes and usable at phone width.
The flow SHALL show its progress as `N / 5` and SHALL present one question per message from the
weaver, written in the weaver's voice, with the human's answer appearing as their own message.

The five steps, in order, SHALL be:

1. the business / workspace name;
2. the workspace id, ticket prefix and directory on the daemon host;
3. the projects to add, followed by the autonomy question ("how much should I check with you before
   acting?");
4. the default CLI and model the workspace runs on;
5. a review of what will be created, and the create action.

A step whose answer is one of a small set SHALL offer those answers as chips the human can pick, and
any control the flow shows SHALL do what its copy promises.

#### Scenario: The projects step matches the mockup

- **WHEN** the flow reaches step 3
- **THEN** the weaver asks which repositories to weave together, the human's git URL appears as
  their message, and the weaver reports what it found before asking the autonomy question

#### Scenario: Progress is stated

- **WHEN** the flow is on any step
- **THEN** it shows that step's number out of five

#### Scenario: A closed-set answer is a chip

- **WHEN** a step asks a question with a small set of answers, such as the autonomy question
- **THEN** those answers are offered as chips that select when activated

#### Scenario: Phone width

- **WHEN** the flow renders at phone width
- **THEN** the conversation fills the width with the composer and chips reachable, and no rail is
  required to move through it

### Requirement: Onboarding drives the existing workspace setup and project add

Completing the V2 flow SHALL create the workspace, set its models and add its projects through the
same daemon operations V1's onboarding uses, with the same results and no new backend surface. The
flow SHALL show the progress and live output of a project add that runs as a job, SHALL offer a retry
for a step that fails without repeating the steps that already succeeded, and SHALL re-attach to a
running job if the page is reloaded mid-create. On success it SHALL record the new workspace as the
remembered one and land the human in V2.

#### Scenario: Completing the flow

- **WHEN** the human finishes all five steps and confirms
- **THEN** the workspace exists, its models and projects are set, and the app opens V2 on that
  workspace

#### Scenario: A project add shows its job

- **WHEN** a project is being added
- **THEN** the flow shows the job's sub-steps and its live output until it ends

#### Scenario: A failure can be retried

- **WHEN** a create step fails
- **THEN** the flow shows what failed and offers a retry that does not repeat the steps that succeeded

#### Scenario: Reload mid-create

- **WHEN** the page is reloaded while the create step is running
- **THEN** the flow comes back on the same step, re-attached to the running job

### Requirement: `/v2` with no remembered workspace resolves to V2 onboarding

When `/v2` is opened by a signed-in visitor with no remembered workspace, the app SHALL resolve to
`/v2/onboarding` rather than V1's `/onboarding`. A visitor who is not signed in SHALL first be sent to
V2's sign-in. V1's `/` and `/onboarding` SHALL stay exactly as they are.

#### Scenario: No workspace remembered

- **WHEN** a signed-in visitor with nothing remembered opens `/v2`
- **THEN** the V2 onboarding flow opens

#### Scenario: Signed out takes sign-in first

- **WHEN** a signed-out visitor with nothing remembered opens `/v2`
- **THEN** the V2 sign-in opens, and completing it leads to V2 onboarding

#### Scenario: V1 onboarding is unchanged

- **WHEN** a visitor with no workspace opens `/`
- **THEN** V1 resolves to its own `/onboarding` exactly as before

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
