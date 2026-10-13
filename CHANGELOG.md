# Changelog

All notable changes to Weave AI are listed here, newest first. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added
- Contributor documentation: `CONTRIBUTING.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md`, issue and pull
  request templates, `CODEOWNERS`.
- The web UI bundles Inter and JetBrains Mono (SIL OFL) instead of loading them from Google Fonts.

### Changed
- ADRs `0012-worker-model-options` and `0013-daemon-model-overrides` are renumbered 0023 and 0024 to
  remove duplicate numbers.
- Docker image and `mise.toml` now agree with CI on Node 26 and pnpm 11.25.0.

### Removed
- Internal host details from `docs/OPERATIONS.md`; design-tool prompt files under `docs/design/v2/uploads/`.

## 0.1.0

The state of the repository when it was prepared for publication. Earlier work is recorded in
`openspec/changes/archive/` and the ADRs in `docs/adr/`.
