# runtime-image-input Specification

## Purpose
Declares, per runtime, the form in which an image attachment can reach that runtime's model — a native
image the model sees, or a readable file path — so a sender knows an image is never silently dropped
on a runtime that cannot take one.

## Requirements

### Requirement: Each runtime declares whether it can take an image natively

Every runtime SHALL declare an image-input capability with one of three forms. `native` means an MCP
`image` content block returned from the agent's inbox reaches the model. `model` means the form depends
on the run's resolved model or provider profile: the run SHALL be `path` only when that profile turns
image input off, and `native` otherwise — the built-in `weave` runtime's codec delivers images unless a
profile declares `compat.image.input: none`. `path` means the runtime cannot take an image block and
SHALL be given a readable path instead. A runtime that declares no capability SHALL be treated as
`path`. The built-in `weave` runtime SHALL declare `model`.

#### Scenario: A native runtime keeps image content

- **WHEN** a run executes on a runtime that declares `native`
- **THEN** an image attachment is delivered to the agent as image content, as before this change

#### Scenario: A model-dependent runtime resolves from its profile

- **WHEN** a run on the built-in `weave` runtime resolves a provider profile whose image input is not turned off
- **THEN** its form is `native`, and when the profile declares `compat.image.input: none` its form is `path`

#### Scenario: An undeclared runtime gets the safe form

- **WHEN** a run executes on a runtime that declares no image-input capability
- **THEN** its form is `path`, never a silently dropped image

### Requirement: An image on a runtime that cannot take one reaches the agent as a readable path

When a run's form is `path`, the daemon SHALL write each image attachment's bytes to a file the agent
can read, SHALL name that file's absolute path in the turn's prompt, and SHALL report the same path in
the attachment's inbox entry in place of image content. The file SHALL be written inside the agent's
own home and SHALL NOT be written into a worker's worktree or into the daemon's state directory. A
text document attachment SHALL continue to be delivered as its literal content on every form.

#### Scenario: The path is named in the prompt

- **WHEN** a turn on a `path`-form runtime is woken by a message carrying an image attachment
- **THEN** the turn's prompt names an absolute path the agent can read for that image

#### Scenario: The inbox reports the same path

- **WHEN** the agent reads its inbox for a message whose image attachment was written out
- **THEN** the attachment's entry carries the readable path and no image content block

#### Scenario: The file is not in the worktree or the state directory

- **WHEN** the daemon writes an attachment for a `path`-form run
- **THEN** the file is inside the agent's home, is not inside a worker's worktree, and is not inside the
  daemon's state directory

#### Scenario: A text document is unchanged

- **WHEN** a message on a `path`-form runtime carries a text document attachment
- **THEN** the inbox delivers its literal content, as it does on a `native` runtime

### Requirement: The form is decided once per turn and is consistent everywhere

The form SHALL be resolved once for a turn and used for both the turn's prompt and the agent's inbox
read, so the two never disagree; it SHALL be carried with the run so a later inbox read on the same run
reports the same form.

#### Scenario: Prompt and inbox agree

- **WHEN** a turn's prompt is built and the same turn later reads its inbox
- **THEN** both report the same form for that run's attachments

#### Scenario: A later read on the run keeps the decided form

- **WHEN** an inbox read happens after the turn's prompt was built
- **THEN** it uses the form decided for that run, not a freshly derived one
