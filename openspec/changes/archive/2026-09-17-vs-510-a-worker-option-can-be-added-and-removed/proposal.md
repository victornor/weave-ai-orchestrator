## Why

Worker options are currently safe to add and remove, but an existing option cannot be reliably edited in place. Replacing an option to change its runtime, model, effort, or runtime-specific options destroys the stable id that tickets reference and makes configuration changes needlessly risky.

## What Changes

- Make the existing worker-option editor persist edits in place while retaining the option id and every field not being changed.
- Apply the same catalog and configured-runtime validation to edits that applies when adding an option; reject invalid edits without changing the saved option.
- Define and test edit timing: already-running workers keep their turn's resolved settings, while later spawns resolve the updated option.
- Ensure the Settings editor exposes the edit controls for daemon and workspace catalogs, with validation feedback and light/dark rendered coverage.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `model-selection/worker-options`: existing catalog options can be edited in place with stable ids, validated runtime/model/effort/options, and next-spawn semantics.

## Impact

- Shared worker-option schemas and catalog validation.
- Model settings persistence and effective-option resolution in the daemon/core.
- V2 Settings worker-option rows and their tests/rendered captures.
- Worker spawn/in-flight tests and existing model-selection specification.
