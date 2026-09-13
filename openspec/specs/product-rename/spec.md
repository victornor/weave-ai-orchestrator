# product-rename Specification

## Purpose
Defines the guarantees of the mechanical product rename from `agent-conductor` to `weave-ai` (CLI
binary `conductor` to `weave`): every live package name, import specifier, binary name, service
identifier, skill directory and agent-facing tool name carries the new spelling consistently, while an
installation that already exists on disk under the old names keeps being found and a fresh one works
end to end under the new names.

## Requirements

### Requirement: No live `@agent-conductor` package name or import specifier remains

Every package name and every import specifier in the build SHALL use the `@weave-ai` scope. No
`package.json` `name`, no internal `dependencies` entry, no TypeScript import specifier, and no
lockfile entry SHALL name `@agent-conductor`. Immutable historical records (archived OpenSpec
changes) are not build inputs and are out of scope.

#### Scenario: A package name is scoped to the new name

- **WHEN** any shipped package's `package.json` is read after this change
- **THEN** its `name` begins `@weave-ai/`, never `@agent-conductor/`

#### Scenario: An import specifier resolves to the new scope

- **WHEN** the monorepo is installed and type-checked after this change
- **THEN** every cross-package import specifier names `@weave-ai/…`, and a search of the live source
  and config for `@agent-conductor` returns nothing

### Requirement: The CLI binary is `weave` in both the bin map and the program name

The command users invoke SHALL be `weave`: the CLI package's `bin` map, Commander's program name, and
the help output SHALL all agree. The daemon's own binary SHALL be `weave-daemon`.

#### Scenario: The help output renders the new program name

- **WHEN** `weave --help` runs
- **THEN** the usage line names `weave`, not `conductor`

#### Scenario: The daemon binary is named for the new product

- **WHEN** the server package's `bin` map is read
- **THEN** it maps `weave-daemon`, not `ac-daemon`

### Requirement: The service and MCP identifiers use the new spelling consistently

`SERVICE_NAME`, `LAUNCHD_LABEL` and `MCP_SERVER_NAME` SHALL each carry a new-name spelling, and the
name used to register the MCP server SHALL equal the name keyed in a run's MCP configuration, so an
agent runtime's MCP client config and the server agree.

#### Scenario: The service names are the new ones

- **WHEN** the release package's service constants are read
- **THEN** `SERVICE_NAME` names the new product's service and `LAUNCHD_LABEL` names the new product's
  launchd label

#### Scenario: The registered MCP server name matches the run config key

- **WHEN** a run's MCP configuration is built
- **THEN** its single server key equals `MCP_SERVER_NAME`, and no old spelling appears in either

### Requirement: Every agent tool name is `weave_`-prefixed, and no offered name is absent from the registered set

The registered MCP tool names SHALL use the `weave_` prefix in place of `ac_`. Every tool name an
agent is offered SHALL be one of the registered names, byte for byte; the shared list, the server
registration, and any size-cap or reply-name constant SHALL agree.

#### Scenario: The registered set is consistently prefixed

- **WHEN** the shared tool-name lists and the server's tool definitions are read
- **THEN** every name begins `weave_`, and no name begins `ac_`

#### Scenario: A prose tool name exists in the registered set

- **WHEN** a tool name written in the agent-facing prose (skills, templates, prompts, docs) is
  checked against the registered set
- **THEN** it matches a registered name exactly, so no instruction names a tool that cannot be called

### Requirement: Skill directories, the manifest and the install lists agree

Every shipped skill directory SHALL be named `weave-ai-*`; `skills/manifest.json` entries and the
per-agent-kind install lists in `packages/core/src/workers/home.ts` SHALL name the same directories,
and the artifact-playbook reader SHALL find the renamed directory.

#### Scenario: An installed agent home receives the renamed skills

- **WHEN** the daemon renders an agent home after this change
- **THEN** the skills it installs are the `weave-ai-*` directories, resolved from the manifest and the
  install list, with no reference to an `agent-conductor-*` directory

### Requirement: An existing old-named installation is still found

After this change, an installation that already exists on disk under the old names SHALL keep
resolving to those directories through the path-compatibility resolvers. A rename of source names
SHALL NOT cause the daemon to look only for new-named directories it did not create, and SHALL NOT
move, copy or delete an existing old-named directory.

#### Scenario: A workspace created under the old names still resolves

- **WHEN** a workspace root contains an old-named state database and no new-named one, and the
  renamed code resolves that workspace's paths
- **THEN** it resolves the old-named state directory and agent home, with no error and no second,
  empty directory created

#### Scenario: A user config directory under the old name still resolves

- **WHEN** the daemon host's config/data/state directory exists under the old name only
- **THEN** the renamed CLI and daemon resolve that same directory

### Requirement: A fresh install in a clean HOME works end to end under the new names

On a host with no prior installation, the renamed product SHALL install and run under the new names:
the CLI binary, a daemon started from a fresh config directory, and a workspace it creates SHALL all
use the new names.

#### Scenario: A clean install runs a daemon under the new names

- **WHEN** the built product is run against a fresh HOME with no prior installation
- **THEN** the daemon starts, the CLI reaches it, and the directories it creates are the new-named
  ones, with no old spelling in the paths or the process list

### Requirement: The human-readable agent name is `Weaver` wherever a person reads it

Every user-visible label, heading, title, status line, empty state, help text, error message and
notification in the web app and the TUI that names the workspace agent SHALL read `Weaver` (or
`weaver` where the sentence needs lowercase). A pointer to a settings section SHALL name a section
that exists. Internal code identifiers, wire values and legacy on-disk spellings are not display
text and SHALL NOT be renamed to satisfy this requirement.

#### Scenario: The chat header names the agent

- **WHEN** the chat route renders its header
- **THEN** the title reads `Weaver`, not `Conductor`

#### Scenario: A queued-message status names the agent

- **WHEN** the composer shows why a message is queued because the agent is mid-turn
- **THEN** the text reads `Weaver is replying — your message is queued`

#### Scenario: A settings model label names the agent

- **WHEN** the workspace or daemon Models settings render the agent's model control
- **THEN** the control's label reads `Weaver`, and a test that queries it by that label finds it

#### Scenario: A dictation pointer names a real settings section

- **WHEN** a dictation help or error message tells the reader where to configure a transcription
  provider
- **THEN** it names the Settings section that actually holds that setting (Dictation), not a section
  that does not exist

### Requirement: Server-written text names the agent `Weaver`

Every string the server writes for a human to read that names the workspace agent SHALL read
`Weaver`. This includes the decision-review follow-up line and route summaries.

#### Scenario: A review follow-up names the reviewer

- **WHEN** the channel manager writes the text follow-up for a decision the weaver has marked with
  concerns
- **THEN** the line begins `Weaver reviewed`, and the channels test asserts that prefix

### Requirement: Agent-facing display text names the role `Weaver`

Text shipped to agents that displays the role name — a turn header rendered from the stored agent
name, a shipped prompt template, and a shipped skill heading — SHALL read `Weaver`. Lowercase,
conceptual uses of the role noun are not display names and are out of scope.

#### Scenario: A turn header shows the stored name

- **WHEN** a stored weaver agent's turn prompt is built after the rename migration
- **THEN** its `# Turn N for …` header shows `Weaver (weaver)`

#### Scenario: A shipped skill heading names the role

- **WHEN** a shipped skill file displays which tools or knowledge the role owns
- **THEN** the heading reads `Weaver`, not `Conductor`

### Requirement: The stored default-named weaver is renamed; a custom name survives

On upgrade, a workspace whose weaver agent still carries the untouched default name `Conductor`
SHALL be renamed to `Weaver`. A weaver whose name was deliberately set to anything other than that
default SHALL keep its name. A newly created workspace SHALL name its weaver `Weaver`.

#### Scenario: The untouched default is renamed

- **WHEN** a workspace database with a `kind = 'weaver'` agent named `Conductor` is migrated
- **THEN** that agent's name is `Weaver`

#### Scenario: A deliberately customised name is left alone

- **WHEN** a workspace database with a `kind = 'weaver'` agent named something other than
  `Conductor` is migrated
- **THEN** its name is unchanged

#### Scenario: A new workspace names its weaver Weaver

- **WHEN** a workspace with no weaver agent is bootstrapped
- **THEN** the weaver it creates is named `Weaver`
