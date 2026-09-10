# agent-prompts/host-toolchains Specification

## Purpose
Always-loaded conductor and worker prompts tell every workspace's agents not
to pin Node in a way that hides host CLIs such as `openspec`, and not to ask
the human to reinstall those CLIs when a pin is the cause.

## Requirements

### Requirement: Worker AGENTS template forbids a Node pin that hides host CLIs

The always-loaded worker instruction template the daemon renders SHALL state
that the worker MUST NOT add or keep a `mise.toml` (or equivalent) Node pin
that makes host CLIs such as `openspec` disappear. It SHALL forbid copying
`package.json` engines from another repository into a pin. It SHALL state
that if OpenSpec is missing only inside a mise-pinned repo, the worker MUST
remove or align the pin rather than ask the human or the conductor to
reinstall the CLI or change the machine Node.

#### Scenario: Worker template names the pin rule

- **WHEN** the shipped worker AGENTS.md template is read as source
- **THEN** it forbids adding or keeping a `mise.toml` Node pin that hides host CLIs such as `openspec`
- **AND** it forbids copying `package.json` engines from another repository into a pin
- **AND** it says that if OpenSpec is missing only inside a mise-pinned repo, remove or align the pin rather than ask the human to reinstall the CLI

#### Scenario: Rendered worker instructions keep the pin rule

- **WHEN** the daemon renders worker AGENTS.md from the shipped template
- **THEN** the rendered file forbids a `mise.toml` Node pin that hides host CLIs such as `openspec`
- **AND** the rendered file says not to ask the human to reinstall the CLI when OpenSpec is missing only inside a pinned repo

### Requirement: Conductor AGENTS template does not treat a pin-hidden OpenSpec as a human reinstall

The always-loaded conductor instruction template the daemon renders SHALL
state that if OpenSpec is missing only inside a mise-pinned repo, that is
not a reason to ask the human to reinstall the CLI or change the machine
Node. It SHALL name removing or aligning the pin as the fix. It SHALL
forbid adding or keeping a `mise.toml` (or equivalent) Node pin that hides
host CLIs, and SHALL forbid copying `package.json` engines from another
repository into a pin.

#### Scenario: Conductor template names the pin rule

- **WHEN** the shipped conductor AGENTS.md template is read as source
- **THEN** it forbids adding or keeping a `mise.toml` Node pin that hides host CLIs such as `openspec`
- **AND** it forbids copying `package.json` engines from another repository into a pin
- **AND** it says not to ask the human to reinstall OpenSpec or change the machine Node when the CLI is missing only inside a pinned repo

#### Scenario: Rendered conductor instructions keep the pin rule

- **WHEN** the daemon renders conductor AGENTS.md from the shipped template
- **THEN** the rendered file forbids a `mise.toml` Node pin that hides host CLIs such as `openspec`
- **AND** the rendered file says not to ask the human to reinstall the CLI when OpenSpec is missing only inside a pinned repo
