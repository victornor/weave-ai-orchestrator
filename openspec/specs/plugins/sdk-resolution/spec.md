# plugins/sdk-resolution Specification

## Purpose
Lets a plugin live entirely outside this monorepo, in its own repository, and still `import` the
real `@weave-ai/plugin-sdk` the running daemon ships at runtime — never a vendored or bundled copy
that can drift from it — while its own toolchain gets that package's real, self-contained type
declarations through an ordinary package install.

## Requirements

### Requirement: A bare `@weave-ai/plugin-sdk` import resolves to the daemon's own running release

When the daemon loads a plugin whose own module imports the bare specifier `@weave-ai/plugin-sdk`,
that import SHALL resolve to the running release's own built `@weave-ai/plugin-sdk`, regardless of
whether the plugin's own directory contains a `node_modules/@weave-ai/plugin-sdk` of its own. This
SHALL hold for a plugin loaded from a directory entirely outside this repository.

#### Scenario: An out-of-tree plugin resolves the SDK

- **WHEN** the daemon loads a plugin whose entry file lives in a directory with no `node_modules` of
  its own, and that file imports `@weave-ai/plugin-sdk`
- **THEN** the import resolves successfully, to the same `@weave-ai/plugin-sdk` build the daemon
  itself runs

#### Scenario: An in-tree plugin is unaffected

- **WHEN** an existing in-tree example plugin imports `@weave-ai/plugin-sdk`
- **THEN** it continues to resolve exactly as it did before this change

#### Scenario: Every other import is unaffected

- **WHEN** a plugin, or any other module in the daemon process, imports anything other than the
  exact specifier `@weave-ai/plugin-sdk`
- **THEN** resolution proceeds exactly as it would with no hook installed

### Requirement: `@weave-ai/plugin-sdk` is published as a self-contained public package

`@weave-ai/plugin-sdk` SHALL be publishable to the public npm registry as a standalone package whose
own type declarations resolve completely on their own, with no reference to any other unpublished
`@weave-ai/*` package. Publishing SHALL happen only through a tag-triggered automated workflow, never
as a manual step taken inside a ticket.

#### Scenario: The packaged tarball is self-contained

- **WHEN** `@weave-ai/plugin-sdk` is packed into a tarball and installed into a fresh project outside
  this repository, with none of this repository's other packages present
- **THEN** a sample plugin file in that project importing `definePlugin` and `PluginHost`-typed
  values from `@weave-ai/plugin-sdk` type-checks with no unresolved-import errors

#### Scenario: Publishing is automated, not manual

- **WHEN** a `plugin-sdk-v*` tag is pushed to the repository
- **THEN** a CI workflow builds and publishes the package to public npm using a repository-held
  credential

#### Scenario: A plugin declares the dependency without vendoring it

- **WHEN** a plugin repository's own `package.json` is examined
- **THEN** it names `@weave-ai/plugin-sdk` as a `peerDependency` (satisfied at runtime by the
  daemon's own resolution, per the requirement above) and, for local type-checking, a
  `devDependency` on the same published package — not a vendored copy of its source
