# Security policy

## Reporting a vulnerability

Please report vulnerabilities **privately** through GitHub's private vulnerability reporting: open the
repository's **Security** tab and choose **Report a vulnerability**. Do not open a public issue or
pull request for a suspected vulnerability.

Include what you found, the version or commit, steps to reproduce, and the impact you expect. We will
acknowledge a report within a few days, keep you informed while we investigate, and credit you in the
fix unless you prefer otherwise.

## Supported versions

Weave AI is pre-1.0. Only the latest release, and the current `main` branch, receive security fixes.
Older releases are not patched; upgrade instead (`weave daemon upgrade`).

## Scope

In scope: the daemon, the `weave` CLI, the web app, the agent-facing tools and the plugin SDK in this
repository. Out of scope: vulnerabilities in third-party coding CLIs or model providers that Weave AI
drives, and deployments that expose the daemon to untrusted networks without the authentication and TLS
settings described in [`docs/OPERATIONS.md`](docs/OPERATIONS.md) and [`docs/DOCKER.md`](docs/DOCKER.md).
