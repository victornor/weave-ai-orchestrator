## ADDED Requirements

### Requirement: Approving a plan starts apply on the runtime in force at launch

Approving a `change` ticket's plan SHALL cause that ticket's worker to take an apply turn even when the workers runtime or model is not the one the propose turn ran on. The apply turn SHALL launch on the workers setting in force at launch. A fresh session on the new runtime is acceptable; sitting idle because the runtime or model changed since the plan-approval card was created is not.

This does not change how a session is persisted when the runtime is unchanged.

#### Scenario: Propose on runtime A, approve after switching to runtime B

- **WHEN** a worker proposes a plan on runtime A, the workers setting is then changed to runtime B, and the plan is approved
- **THEN** an apply turn starts for that worker
- **AND** that turn is launched on runtime B
- **AND** no session handle from runtime A is passed to it
