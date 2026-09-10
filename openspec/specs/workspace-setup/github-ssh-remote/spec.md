# workspace-setup/github-ssh-remote Specification

## Purpose
Persists GitHub project remotes as SSH so workers can clone, fetch and push with the daemon user's existing SSH keys instead of prompting for HTTPS credentials.

## Requirements

### Requirement: GitHub HTTPS remotes are stored as SSH

When a project is added, a GitHub remote whose host is `github.com` and whose path is `owner/repo` (optional `.git`, optional trailing slash) SHALL be persisted as `git@github.com:owner/repo.git`. The rewrite SHALL apply whether the input used `https://`, `http://`, `ssh://git@github.com/…`, `git@github.com:…`, or a schemeless `github.com/owner/repo` paste.

The rewritten URL SHALL be what is stored on the project record and in the workspace project declaration, and SHALL be the URL used to clone. The add SHALL NOT be refused because the paste was HTTPS, and the operator SHALL NOT be asked to re-paste an SSH URL.

A URL that is already the canonical SSH form SHALL be stored unchanged.

#### Scenario: HTTPS without .git becomes SSH

- **WHEN** a project is added with url `https://github.com/victornor/WidgetShop`
- **THEN** the stored remote is `git@github.com:victornor/WidgetShop.git` and the add proceeds

#### Scenario: HTTPS with .git becomes SSH

- **WHEN** a project is added with url `https://github.com/victornor/WidgetShop.git`
- **THEN** the stored remote is `git@github.com:victornor/WidgetShop.git`

#### Scenario: Schemeless github.com/owner/repo becomes SSH

- **WHEN** a project is added with url `github.com/victornor/WidgetShop`
- **THEN** the stored remote is `git@github.com:victornor/WidgetShop.git`

#### Scenario: Already-SSH GitHub URL stays canonical

- **WHEN** a project is added with url `git@github.com:victornor/WidgetShop.git`
- **THEN** the stored remote is `git@github.com:victornor/WidgetShop.git`

### Requirement: Non-GitHub remotes are stored as given

A remote whose host is not `github.com` SHALL be stored as given, including HTTPS GitLab, Codeberg, a self-hosted forge, and a local filesystem path. A GitHub URL whose path is not exactly `owner/repo` (for example extra path segments) SHALL also be stored as given.

#### Scenario: GitLab HTTPS is unchanged

- **WHEN** a project is added with url `https://gitlab.com/acme/api.git`
- **THEN** the stored remote is `https://gitlab.com/acme/api.git`

#### Scenario: A local path is unchanged

- **WHEN** a project is added with a local filesystem path as its url
- **THEN** the stored remote is that path

#### Scenario: A GitHub URL with extra path segments is unchanged

- **WHEN** a project is added with url `https://github.com/victornor/WidgetShop/tree/main`
- **THEN** the stored remote is `https://github.com/victornor/WidgetShop/tree/main`

### Requirement: A retried add also rewrites

Retrying a failed project add SHALL persist the SSH form when the stored url is a GitHub HTTPS or schemeless `github.com/owner/repo` remote, so a retry does not keep cloning over HTTPS.

#### Scenario: Retry of a GitHub HTTPS add stores SSH

- **WHEN** a project whose add failed was given a GitHub HTTPS url and is retried
- **THEN** the stored remote after the retry starts is `git@github.com:owner/repo.git`
