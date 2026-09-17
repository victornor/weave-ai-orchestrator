## 1. Shared and service validation

- [x] 1.1 Add a shared worker-option validation path for registered runtime ids and preserve the existing schema/runtime-option checks; verify unknown or unavailable runtime edits are rejected with the runtime named and valid existing catalogs still load.
- [x] 1.2 Apply the validation to both workspace and daemon model writes without changing add/remove or overlay semantics; verify direct PUT tests prove an invalid edit leaves the complete prior option unchanged.

## 2. Settings editor

- [x] 2.1 Update the worker-option row editor so runtime, model, effort and runtime-specific option changes submit a complete option while preserving id, description, and untouched fields; verify focused UI tests cover changing each editable field and stable id preservation.
- [x] 2.2 Make unset/unavailable runtimes explicit in the row and surface schema-derived validation errors and character limits before save; verify the add/edit controls are disabled or show the offending reason for invalid values.
- [x] 2.3 Keep existing model-setting controls' behavior intact while giving option rows the preserve-untouched-fields runtime-change behavior; verify shared UI tests cover effort retention and clearing only when the model change requires it.

## 3. Runtime resolution and regression coverage

- [x] 3.1 Add core model-resolution tests proving an edited option is used by the next spawn, keeps its ticket option id, and does not alter a run that already resolved the old setting.
- [x] 3.2 Add server/core regression coverage for catalog edits through both workspace and daemon paths, including model, effort, runtime options, duplicate/shape errors, and invalid runtime rollback; verify the relevant core and server test suites pass.

## 4. Visual verification and delivery

- [x] 4.1 Exercise the Settings worker-option editor in rendered light and dark themes, capturing the expanded edit row, validation feedback, and stable-id edit state; verify both captures show the edit controls beside add/remove and record the capture paths on the ticket.
- [x] 4.2 Run the project lint/typecheck and both test suite blocks, tick all completed tasks, and commit the implementation and OpenSpec task updates with VS-510 in the commit message.
