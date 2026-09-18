## MODIFIED Requirements

### Requirement: Attachment paths use the existing explicit allowlist

The tool SHALL resolve a supplied path through its real path and accept only a regular file inside
the workspace knowledge tree, a project clone, a worker worktree already allowed by outbound
attachments, or the acting agent's own home directory. The acting agent's home SHALL mean only the
home of the agent making the request — the live worker home under `workers/<agentId>` or the retired
one under `archive/workers/<agentId>` — never another agent's home and never the workspace root. The
home allowance SHALL be guarded: the candidate and the home SHALL be compared after resolving
symlinks, not lexically, and a path resolving under the home SHALL be refused when any segment
relative to the home is hidden (a dotfile or dot-directory), so the runtime's own config tree is
never attachable even when part of it symlinks elsewhere. Symlinks resolving outside those roots, any
`.git` path segment, unreadable/non-regular paths, and files over the outbound per-file cap SHALL be
rejected by name before any row or file is written. Validation SHALL be all-or-nothing for the
request. The outbound chat attachment allowlist SHALL NOT be widened by this change.

#### Scenario: A path outside the allowlist is refused

- **WHEN** a worker names a readable file outside the knowledge, project, worker-worktree and its own
  home roots
- **THEN** the call fails with a validation error naming that path, and no attachment is stored

#### Scenario: A large real screenshot is accepted within the cap

- **WHEN** a worker names a valid image larger than the former base64 tool-call payload but within
  the outbound per-file cap
- **THEN** the call succeeds without requiring the worker to transcribe or resize the image

#### Scenario: A capture saved in the worker's home is attachable

- **WHEN** a worker writes a render into its own home directory outside `work/` and names that path
- **THEN** the call succeeds and the stored bytes are the render's bytes

#### Scenario: Another agent's home is not attachable

- **WHEN** a worker names a file inside a different worker's home
- **THEN** the call fails with a validation error naming that path, and no attachment is stored

#### Scenario: The home's runtime config is not attachable

- **WHEN** a worker names a dotfile or a file inside a dot-directory under its own home
- **THEN** the call fails with a validation error, and no attachment is stored

#### Scenario: A symlink in the home that escapes it is refused

- **WHEN** a symlink inside the worker's home points outside the home to a file on the rest of the
  host
- **THEN** the call fails with a validation error, and no attachment is stored

## ADDED Requirements

### Requirement: The attach affordance tells an agent to attach rendered evidence

The `weave_ticket_attachment_put` tool description SHALL direct an agent to attach rendered evidence
to the ticket rather than cite a filesystem path, and SHALL name the agent's own home directory as an
accepted place to save a capture and attach it from. The worker skill SHALL carry the same
instruction, so a worker producing a visual change attaches the render before it asks for approval
instead of leaving it in a scratch directory.

#### Scenario: The tool description names rendered evidence

- **WHEN** an agent reads the `weave_ticket_attachment_put` description
- **THEN** it tells the agent to attach rendered evidence to the ticket and that the agent's own home
  is an accepted source

#### Scenario: The worker skill names rendered evidence

- **WHEN** a worker loads the worker skill while preparing a visual change for approval
- **THEN** the skill tells it to attach the rendered evidence to the ticket so the approval card can
  show it
